import { describe, expect, it } from 'vitest';
import { patchesFor } from '../visibility/index.js';
import type { ActionEnvelope } from './envelope.js';
import { aoePlace } from './aoe.place.js';
import { reduceAction } from './run.js';
import { ACTORS, IDS, makeCampaign, makeEntity, permissionMatrix, testId } from './testing.js';

const T = 'aoe.place';
const aoeId = testId(12);
const entity = {
  ...makeEntity(aoeId, { layer: 'effects', name: 'Fireball' }),
  aoe: { kind: 'sphere' as const, radius: 4, color: '#ff4400' },
};
const payload = { sceneId: IDS.scene, entity };
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
  it('accepts all five shapes and rejects missing, malformed or extra data', () => {
    const shapes = [
      { kind: 'sphere', radius: 2, color: 'red' },
      { kind: 'cylinder', radius: 2, height: 3, color: 'red' },
      { kind: 'cone', radius: 2, length: 3, color: 'red' },
      { kind: 'cube', size: 2, color: 'red' },
      { kind: 'line', length: 3, width: 1, height: 1, color: 'red' },
    ];
    for (const aoe of shapes)
      expect(aoePlace.schema.safeParse({ ...payload, entity: { ...entity, aoe } }).success).toBe(
        true,
      );
    expect(aoePlace.schema.safeParse({ sceneId: IDS.scene }).success).toBe(false);
    expect(
      aoePlace.schema.safeParse({ ...payload, entity: { ...entity, aoe: { kind: 'sphere' } } })
        .success,
    ).toBe(false);
    expect(aoePlace.schema.safeParse({ ...payload, extra: true }).success).toBe(false);
    expect(
      aoePlace.schema.safeParse({ ...payload, entity: { ...entity, token: {} } }).success,
    ).toBe(false);
  });
});

describe(`${T} permissions`, () => {
  it('allows host and co-DM but denies players, spectators and mods by default', () => {
    expect(permissionMatrix(makeCampaign(), T, payload)).toEqual({
      host: true,
      owner: false,
      otherSeat: false,
      coDm: true,
      spectator: false,
      mod: false,
    });
  });

  it('allows a player granted edit to place only their own visible-layer AoE', () => {
    const state = makeCampaign();
    const seat = state.seats[IDS.owner];
    if (seat) seat.permissions.edit = true;
    const owned = { ...payload, entity: { ...entity, owners: [IDS.owner] } };
    expect(aoePlace.permission(state, ACTORS.owner, owned)).toBe(true);
    expect(
      aoePlace.permission(state, ACTORS.owner, {
        ...owned,
        entity: { ...owned.entity, layer: 'dm' },
      }),
    ).toBe(false);
  });

  it('rejects duplicate ids, unknown owners and locked layers', () => {
    const duplicate = makeCampaign();
    const scene = duplicate.scenes[IDS.scene];
    if (scene) scene.entities[aoeId] = entity;
    expect(aoePlace.permission(duplicate, ACTORS.host, payload)).toBe(false);
    expect(
      aoePlace.permission(makeCampaign(), ACTORS.host, {
        ...payload,
        entity: { ...entity, owners: [testId(24)] },
      }),
    ).toBe(false);
    const locked = makeCampaign();
    const lockedScene = locked.scenes[IDS.scene];
    if (lockedScene) lockedScene.layers.effects = { locked: true };
    expect(aoePlace.permission(locked, ACTORS.host, payload)).toBe(false);
  });
});

describe(`${T} reducer and visibility`, () => {
  it('places the AoE deterministically without mutating the input', () => {
    const before = makeCampaign();
    const result = reduceAction(before, envelope());
    expect(result.state.scenes[IDS.scene]?.entities[aoeId]).toEqual(entity);
    expect(before.scenes[IDS.scene]?.entities[aoeId]).toBeUndefined();
    expect(result).toEqual(reduceAction(makeCampaign(), envelope()));
  });

  it('does not send an AoE placed on the DM layer to players or spectators', () => {
    const hidden = { ...payload, entity: { ...entity, layer: 'dm' as const, name: 'SECRET' } };
    const before = makeCampaign();
    const result = reduceAction(before, envelope(hidden));
    for (const audience of [{ kind: 'seat', seatId: IDS.owner }, { kind: 'spectators' }] as const)
      expect(patchesFor(audience, before, result.state, result.patches)).toEqual([]);
  });
});
