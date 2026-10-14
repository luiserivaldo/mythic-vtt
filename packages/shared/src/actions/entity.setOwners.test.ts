import { describe, expect, it } from 'vitest';
import { patchesFor } from '../visibility/index.js';
import type { ActionEnvelope } from './envelope.js';
import { entitySetOwners } from './entity.setOwners.js';
import { reduceAction } from './run.js';
import { ACTORS, IDS, makeCampaign, makeEntity, permissionMatrix, testId } from './testing.js';

const T = 'entity.setOwners';
const payload = { sceneId: IDS.scene, entityId: IDS.entity, owners: [IDS.other] };
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
    expect(entitySetOwners.schema.safeParse(payload).success).toBe(true);
    expect(entitySetOwners.schema.safeParse({ ...payload, owners: [3] }).success).toBe(false);
    expect(
      entitySetOwners.schema.safeParse({ sceneId: IDS.scene, entityId: IDS.entity }).success,
    ).toBe(false);
    expect(entitySetOwners.schema.safeParse({ ...payload, extra: true }).success).toBe(false);
  });

  it('allows only host and co-DM', () => {
    expect(permissionMatrix(stateWithEntity(), T, payload)).toEqual({
      host: true,
      owner: false,
      otherSeat: false,
      coDm: true,
      spectator: false,
      mod: false,
    });
  });

  it('rejects duplicate and unknown owners or a missing entity', () => {
    const state = stateWithEntity();
    expect(
      entitySetOwners.permission(state, ACTORS.host, {
        ...payload,
        owners: [IDS.owner, IDS.owner],
      }),
    ).toBe(false);
    expect(
      entitySetOwners.permission(state, ACTORS.host, { ...payload, owners: [testId(24)] }),
    ).toBe(false);
    expect(entitySetOwners.permission(makeCampaign(), ACTORS.host, payload)).toBe(false);
  });
});

describe(`${T} reducer and visibility`, () => {
  it('replaces owners deterministically without mutating the input', () => {
    const before = stateWithEntity();
    const result = reduceAction(before, envelope());
    expect(result.state.scenes[IDS.scene]?.entities[IDS.entity]?.owners).toEqual([IDS.other]);
    expect(before.scenes[IDS.scene]?.entities[IDS.entity]?.owners).toEqual([IDS.owner]);
    expect(result).toEqual(reduceAction(stateWithEntity(), envelope()));
  });

  it('does not leak ownership changes on the DM layer', () => {
    const before = stateWithEntity('dm');
    const result = reduceAction(before, envelope());
    for (const audience of [{ kind: 'seat', seatId: IDS.owner }, { kind: 'spectators' }] as const)
      expect(patchesFor(audience, before, result.state, result.patches)).toEqual([]);
  });
});
