import { describe, expect, it } from 'vitest';
import { patchesFor } from '../visibility/index.js';
import type { ActionEnvelope } from './envelope.js';
import { aoeRemove } from './aoe.remove.js';
import { reduceAction } from './run.js';
import { ACTORS, IDS, makeCampaign, makeEntity, permissionMatrix } from './testing.js';

const T = 'aoe.remove';
const payload = { sceneId: IDS.scene, entityId: IDS.entity };
const envelope = (p: unknown = payload): ActionEnvelope => ({
  id: IDS.action,
  type: T,
  payload: p,
  actor: ACTORS.host,
  campaignId: IDS.campaign,
  sceneId: IDS.scene,
  sessionId: IDS.session,
  seq: 1,
  ts: 1_000,
});
const stateWithAoE = () => {
  const state = makeCampaign();
  const scene = state.scenes[IDS.scene];
  if (scene)
    scene.entities[IDS.entity] = makeEntity(IDS.entity, {
      layer: 'effects',
      aoe: { kind: 'line', length: 6, width: 1, height: 1, color: '#00ffff' },
    });
  return state;
};

describe(`${T} schema`, () => {
  it('accepts a valid payload and rejects missing, malformed or extra data', () => {
    expect(aoeRemove.schema.safeParse(payload).success).toBe(true);
    expect(aoeRemove.schema.safeParse({ sceneId: IDS.scene }).success).toBe(false);
    expect(aoeRemove.schema.safeParse({ ...payload, entityId: 4 }).success).toBe(false);
    expect(aoeRemove.schema.safeParse({ ...payload, extra: true }).success).toBe(false);
  });
});

describe(`${T} permissions`, () => {
  it('allows host and co-DM but denies players, spectators and mods by default', () => {
    expect(permissionMatrix(stateWithAoE(), T, payload)).toEqual({
      host: true,
      owner: false,
      otherSeat: false,
      coDm: true,
      spectator: false,
      mod: false,
    });
  });

  it('allows an owner granted delete permission to remove the AoE', () => {
    const state = stateWithAoE();
    const seat = state.seats[IDS.owner];
    const aoe = state.scenes[IDS.scene]?.entities[IDS.entity];
    if (seat) seat.permissions.delete = true;
    if (aoe) aoe.owners = [IDS.owner];
    expect(aoeRemove.permission(state, ACTORS.owner, payload)).toBe(true);
  });

  it('rejects non-AoE entities and locked layers', () => {
    const plain = makeCampaign();
    const scene = plain.scenes[IDS.scene];
    if (scene) scene.entities[IDS.entity] = makeEntity(IDS.entity);
    expect(aoeRemove.permission(plain, ACTORS.host, payload)).toBe(false);
    const locked = stateWithAoE();
    const lockedScene = locked.scenes[IDS.scene];
    if (lockedScene) lockedScene.layers.effects = { locked: true };
    expect(aoeRemove.permission(locked, ACTORS.host, payload)).toBe(false);
  });
});

describe(`${T} reducer and visibility`, () => {
  it('removes deterministically without mutating the input', () => {
    const before = stateWithAoE();
    const result = reduceAction(before, envelope());
    expect(result.state.scenes[IDS.scene]?.entities[IDS.entity]).toBeUndefined();
    expect(before.scenes[IDS.scene]?.entities[IDS.entity]).toBeDefined();
    expect(result).toEqual(reduceAction(stateWithAoE(), envelope()));
  });

  it('does not leak removal of a DM-layer AoE', () => {
    const before = stateWithAoE();
    const entity = before.scenes[IDS.scene]?.entities[IDS.entity];
    if (entity) entity.layer = 'dm';
    const result = reduceAction(before, envelope());
    for (const audience of [{ kind: 'seat', seatId: IDS.owner }, { kind: 'spectators' }] as const)
      expect(patchesFor(audience, before, result.state, result.patches)).toEqual([]);
  });
});
