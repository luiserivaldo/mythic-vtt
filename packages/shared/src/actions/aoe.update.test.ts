import { describe, expect, it } from 'vitest';
import { patchesFor } from '../visibility/index.js';
import type { ActionEnvelope } from './envelope.js';
import { aoeUpdate } from './aoe.update.js';
import { reduceAction } from './run.js';
import { ACTORS, IDS, makeCampaign, makeEntity, permissionMatrix } from './testing.js';

const T = 'aoe.update';
const moved = {
  position: { x: 2, y: 3, z: 4 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: 1, y: 1, z: 1 },
};
const shape = { kind: 'cone' as const, radius: 3, length: 6, color: '#ff0000' };
const payload = {
  sceneId: IDS.scene,
  entityId: IDS.entity,
  changes: { transform: moved, aoe: shape },
};
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
      aoe: { kind: 'sphere', radius: 2, color: '#ffffff' },
    });
  return state;
};

describe(`${T} schema`, () => {
  it('accepts changes and rejects empty, malformed, protected or extra fields', () => {
    expect(aoeUpdate.schema.safeParse(payload).success).toBe(true);
    expect(aoeUpdate.schema.safeParse({ ...payload, changes: {} }).success).toBe(false);
    expect(
      aoeUpdate.schema.safeParse({ ...payload, changes: { aoe: { kind: 'line', length: 3 } } })
        .success,
    ).toBe(false);
    expect(aoeUpdate.schema.safeParse({ ...payload, changes: { owners: [] } }).success).toBe(false);
    expect(aoeUpdate.schema.safeParse({ ...payload, extra: true }).success).toBe(false);
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

  it('allows an owner granted edit to move and reshape the AoE', () => {
    const state = stateWithAoE();
    const seat = state.seats[IDS.owner];
    const aoe = state.scenes[IDS.scene]?.entities[IDS.entity];
    if (seat) seat.permissions.edit = true;
    if (aoe) aoe.owners = [IDS.owner];
    expect(aoeUpdate.permission(state, ACTORS.owner, payload)).toBe(true);
  });

  it('rejects non-AoE entities and locked layers', () => {
    const plain = makeCampaign();
    const scene = plain.scenes[IDS.scene];
    if (scene) scene.entities[IDS.entity] = makeEntity(IDS.entity);
    expect(aoeUpdate.permission(plain, ACTORS.host, payload)).toBe(false);
    const locked = stateWithAoE();
    const lockedScene = locked.scenes[IDS.scene];
    if (lockedScene) lockedScene.layers.effects = { locked: true };
    expect(aoeUpdate.permission(locked, ACTORS.host, payload)).toBe(false);
  });
});

describe(`${T} reducer and visibility`, () => {
  it('updates deterministically without mutating the input', () => {
    const before = stateWithAoE();
    const result = reduceAction(before, envelope());
    expect(result.state.scenes[IDS.scene]?.entities[IDS.entity]?.transform).toEqual(moved);
    expect(result.state.scenes[IDS.scene]?.entities[IDS.entity]?.aoe).toEqual(shape);
    expect(before.scenes[IDS.scene]?.entities[IDS.entity]?.transform.position.x).toBe(0);
    expect(result).toEqual(reduceAction(stateWithAoE(), envelope()));
  });

  it('does not leak updates to a DM-layer AoE', () => {
    const before = stateWithAoE();
    const entity = before.scenes[IDS.scene]?.entities[IDS.entity];
    if (entity) entity.layer = 'dm';
    const result = reduceAction(before, envelope());
    for (const audience of [{ kind: 'seat', seatId: IDS.owner }, { kind: 'spectators' }] as const)
      expect(patchesFor(audience, before, result.state, result.patches)).toEqual([]);
  });
});
