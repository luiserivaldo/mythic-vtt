import { describe, expect, it } from 'vitest';
import { patchesFor } from '../visibility/index.js';
import type { ActionEnvelope } from './envelope.js';
import { pinRemove } from './pin.remove.js';
import { reduceAction } from './run.js';
import { ACTORS, IDS, makeCampaign, makeEntity, permissionMatrix } from './testing.js';

const T = 'pin.remove';
const pin = { text: 'Remove this note', reveal: 'click' as const };
const payload = { sceneId: IDS.scene, entityId: IDS.entity };
const envelope = (): ActionEnvelope => ({
  id: IDS.action,
  type: T,
  payload,
  actor: ACTORS.host,
  campaignId: IDS.campaign,
  sceneId: IDS.scene,
  sessionId: IDS.session,
  seq: 1,
  ts: 1_000,
});
const stateWithPin = () => {
  const state = makeCampaign();
  const scene = state.scenes[IDS.scene];
  if (scene) scene.entities[IDS.entity] = makeEntity(IDS.entity, { pin });
  return state;
};

describe(`${T} schema`, () => {
  it('accepts a valid payload and rejects missing, malformed or extra data', () => {
    expect(pinRemove.schema.safeParse(payload).success).toBe(true);
    expect(pinRemove.schema.safeParse({ sceneId: IDS.scene }).success).toBe(false);
    expect(pinRemove.schema.safeParse({ ...payload, entityId: 4 }).success).toBe(false);
    expect(pinRemove.schema.safeParse({ ...payload, extra: true }).success).toBe(false);
  });
});

describe(`${T} permissions`, () => {
  it('allows host and co-DM but denies players, spectators and mods by default', () => {
    expect(permissionMatrix(stateWithPin(), T, payload)).toEqual({
      host: true,
      owner: false,
      otherSeat: false,
      coDm: true,
      spectator: false,
      mod: false,
    });
  });

  it('rejects missing pins, locked layers and co-DM writes on the DM layer', () => {
    expect(pinRemove.permission(makeCampaign(), ACTORS.host, payload)).toBe(false);
    const locked = stateWithPin();
    const lockedScene = locked.scenes[IDS.scene];
    if (lockedScene) lockedScene.layers.tokens = { locked: true };
    expect(pinRemove.permission(locked, ACTORS.host, payload)).toBe(false);
    const dm = stateWithPin();
    const dmEntity = dm.scenes[IDS.scene]?.entities[IDS.entity];
    if (dmEntity) dmEntity.layer = 'dm';
    expect(pinRemove.permission(dm, ACTORS.host, payload)).toBe(true);
    expect(pinRemove.permission(dm, ACTORS.coDm, payload)).toBe(false);
  });
});

describe(`${T} reducer and visibility`, () => {
  it('removes only the component deterministically without mutating the input', () => {
    const before = stateWithPin();
    const result = reduceAction(before, envelope());
    expect(result.state.scenes[IDS.scene]?.entities[IDS.entity]).toBeDefined();
    expect(result.state.scenes[IDS.scene]?.entities[IDS.entity]?.pin).toBeUndefined();
    expect(before.scenes[IDS.scene]?.entities[IDS.entity]?.pin).toEqual(pin);
    expect(result).toEqual(reduceAction(stateWithPin(), envelope()));
  });

  it('does not reveal a DM-layer pin while removing it', () => {
    const before = stateWithPin();
    const entity = before.scenes[IDS.scene]?.entities[IDS.entity];
    if (entity) entity.layer = 'dm';
    const result = reduceAction(before, envelope());
    for (const audience of [{ kind: 'seat', seatId: IDS.owner }, { kind: 'spectators' }] as const) {
      const patches = patchesFor(audience, before, result.state, result.patches);
      expect(patches).toEqual([]);
      expect(JSON.stringify(patches)).not.toContain(pin.text);
    }
    expect(patchesFor({ kind: 'host' }, before, result.state, result.patches)).not.toEqual([]);
  });
});
