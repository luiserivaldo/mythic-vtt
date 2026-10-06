import { describe, expect, it } from 'vitest';
import { patchesFor } from '../visibility/index.js';
import type { ActionEnvelope } from './envelope.js';
import { entityDelete } from './entity.delete.js';
import { reduceAction } from './run.js';
import { ACTORS, IDS, makeCampaign, makeEntity, permissionMatrix } from './testing.js';

const T = 'entity.delete';
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
const stateWithEntity = (layer: 'tokens' | 'dm' = 'tokens') => {
  const state = makeCampaign();
  const scene = state.scenes[IDS.scene];
  if (scene)
    scene.entities[IDS.entity] = makeEntity(IDS.entity, {
      layer,
      owners: [IDS.owner],
      name: 'SECRET',
    });
  return state;
};

describe(`${T} schema and permissions`, () => {
  it('accepts a valid payload and rejects missing, malformed or extra fields', () => {
    expect(entityDelete.schema.safeParse(payload).success).toBe(true);
    expect(entityDelete.schema.safeParse({ sceneId: IDS.scene }).success).toBe(false);
    expect(entityDelete.schema.safeParse({ ...payload, entityId: 3 }).success).toBe(false);
    expect(entityDelete.schema.safeParse({ ...payload, extra: true }).success).toBe(false);
  });

  it('allows admins by default and players only through delete gates', () => {
    expect(permissionMatrix(stateWithEntity(), T, payload)).toEqual({
      host: true,
      owner: false,
      otherSeat: false,
      coDm: true,
      spectator: false,
      mod: false,
    });
    const state = stateWithEntity();
    const owner = state.seats[IDS.owner];
    if (owner) owner.permissions.delete = true;
    expect(entityDelete.permission(state, ACTORS.owner, payload)).toBe(true);
    const other = state.seats[IDS.other];
    const entity = state.scenes[IDS.scene]?.entities[IDS.entity];
    if (other) other.permissions.delete = true;
    if (entity) entity.perms = { delete: true };
    expect(entityDelete.permission(state, ACTORS.otherSeat, payload)).toBe(true);
  });

  it('rejects missing entities and locked layers', () => {
    expect(entityDelete.permission(makeCampaign(), ACTORS.host, payload)).toBe(false);
    const state = stateWithEntity();
    const scene = state.scenes[IDS.scene];
    if (scene) scene.layers.tokens = { locked: true };
    expect(entityDelete.permission(state, ACTORS.host, payload)).toBe(false);
  });
});

describe(`${T} reducer and visibility`, () => {
  it('deletes deterministically without mutating the input', () => {
    const before = stateWithEntity();
    const result = reduceAction(before, envelope());
    expect(result.state.scenes[IDS.scene]?.entities[IDS.entity]).toBeUndefined();
    expect(before.scenes[IDS.scene]?.entities[IDS.entity]).toBeDefined();
    expect(result).toEqual(reduceAction(stateWithEntity(), envelope()));
  });

  it('does not leak a deleted DM-layer entity', () => {
    const before = stateWithEntity('dm');
    const result = reduceAction(before, envelope());
    for (const audience of [{ kind: 'seat', seatId: IDS.owner }, { kind: 'spectators' }] as const)
      expect(patchesFor(audience, before, result.state, result.patches)).toEqual([]);
  });
});
