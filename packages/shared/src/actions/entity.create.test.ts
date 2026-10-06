import { describe, expect, it } from 'vitest';
import { patchesFor } from '../visibility/index.js';
import type { ActionEnvelope } from './envelope.js';
import { entityCreate } from './entity.create.js';
import { reduceAction } from './run.js';
import { ACTORS, IDS, makeCampaign, makeEntity, permissionMatrix, testId } from './testing.js';

const T = 'entity.create';
const createdId = testId(12);
const payload = { sceneId: IDS.scene, entity: makeEntity(createdId) };
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

describe(`${T} schema`, () => {
  it('accepts a valid payload and rejects malformed or extra data', () => {
    expect(entityCreate.schema.safeParse(payload).success).toBe(true);
    expect(entityCreate.schema.safeParse({ sceneId: IDS.scene }).success).toBe(false);
    expect(entityCreate.schema.safeParse({ ...payload, extra: true }).success).toBe(false);
    expect(
      entityCreate.schema.safeParse({ ...payload, entity: { ...payload.entity, id: 4 } }).success,
    ).toBe(false);
  });
});

describe(`${T} permissions`, () => {
  it('allows only host and co-DM by default', () => {
    expect(permissionMatrix(makeCampaign(), T, payload)).toEqual({
      host: true,
      owner: false,
      otherSeat: false,
      coDm: true,
      spectator: false,
      mod: false,
    });
  });

  it('rejects duplicates, unknown owners and locked target layers', () => {
    const duplicate = makeCampaign();
    const scene = duplicate.scenes[IDS.scene];
    if (scene) scene.entities[createdId] = payload.entity;
    expect(entityCreate.permission(duplicate, ACTORS.host, payload)).toBe(false);
    expect(
      entityCreate.permission(makeCampaign(), ACTORS.host, {
        ...payload,
        entity: makeEntity(createdId, { owners: [testId(24)] }),
      }),
    ).toBe(false);
    const locked = makeCampaign();
    const lockedScene = locked.scenes[IDS.scene];
    if (lockedScene) lockedScene.layers.tokens = { locked: true };
    expect(entityCreate.permission(locked, ACTORS.host, payload)).toBe(false);
  });
});

describe(`${T} reducer and visibility`, () => {
  it('creates the entity deterministically without mutating the input', () => {
    const before = makeCampaign();
    const result = reduceAction(before, envelope());
    expect(result.state.scenes[IDS.scene]?.entities[createdId]).toEqual(payload.entity);
    expect(before.scenes[IDS.scene]?.entities[createdId]).toBeUndefined();
    expect(result).toEqual(reduceAction(makeCampaign(), envelope()));
  });

  it('does not send a created DM-layer entity to players or spectators', () => {
    const hidden = { ...payload, entity: makeEntity(createdId, { layer: 'dm', name: 'SECRET' }) };
    const before = makeCampaign();
    const result = reduceAction(before, envelope(hidden));
    for (const audience of [{ kind: 'seat', seatId: IDS.owner }, { kind: 'spectators' }] as const) {
      expect(patchesFor(audience, before, result.state, result.patches)).toEqual([]);
    }
  });
});
