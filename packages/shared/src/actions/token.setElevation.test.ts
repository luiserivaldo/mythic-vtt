import { describe, expect, it } from 'vitest';
import { patchesFor } from '../visibility/index.js';
import type { ActionEnvelope } from './envelope.js';
import { reduceAction } from './run.js';
import { ACTORS, IDS, makeCampaign, makeEntity, permissionMatrix } from './testing.js';
import { tokenSetElevation } from './token.setElevation.js';

const T = 'token.setElevation';
const payload = { sceneId: IDS.scene, entityId: IDS.entity, elevation: 2 };
const envelope = (p: unknown = payload): ActionEnvelope => ({
  id: IDS.action,
  type: T,
  payload: p,
  actor: ACTORS.owner,
  campaignId: IDS.campaign,
  sceneId: IDS.scene,
  sessionId: IDS.session,
  seq: 1,
  ts: 1_000,
});

const stateWithToken = () => {
  const state = makeCampaign();
  const scene = state.scenes[IDS.scene];
  if (scene) {
    scene.entities[IDS.entity] = makeEntity(IDS.entity, {
      owners: [IDS.owner],
      token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
    });
    const entity = scene.entities[IDS.entity];
    if (entity) entity.transform.position = { x: 3, y: 0, z: 4 };
  }
  return state;
};

describe(`${T} schema`, () => {
  it('accepts a valid payload and rejects bad data', () => {
    expect(tokenSetElevation.schema.safeParse(payload).success).toBe(true);
    expect(tokenSetElevation.schema.safeParse({ ...payload, elevation: -2.5 }).success).toBe(true);
    for (const bad of [
      { sceneId: IDS.scene, entityId: IDS.entity },
      { ...payload, elevation: '2' },
      { ...payload, elevation: NaN },
      { ...payload, elevation: Infinity },
      { ...payload, elevation: 1000.5 },
      { ...payload, elevation: -1001 },
      { ...payload, entityId: 7 },
      { ...payload, extra: true },
    ]) {
      expect(tokenSetElevation.schema.safeParse(bad).success).toBe(false);
    }
    expect(tokenSetElevation.schema.safeParse({ ...payload, elevation: 1000 }).success).toBe(true);
    expect(tokenSetElevation.schema.safeParse({ ...payload, elevation: -1000 }).success).toBe(true);
  });
});

describe(`${T} permissions`, () => {
  it('allows admins and the owner, denies other seats, spectators and mods', () => {
    expect(permissionMatrix(stateWithToken(), T, payload)).toEqual({
      host: true,
      owner: true,
      otherSeat: false,
      coDm: true,
      spectator: false,
      mod: false,
    });
  });

  it('follows the owner seat move capability', () => {
    const state = stateWithToken();
    const owner = state.seats[IDS.owner];
    if (owner) owner.permissions.move = false;
    expect(tokenSetElevation.permission(state, ACTORS.owner, payload)).toBe(false);
  });

  it('rejects missing entities, non-tokens and locked layers', () => {
    expect(tokenSetElevation.permission(makeCampaign(), ACTORS.host, payload)).toBe(false);
    const nonToken = stateWithToken();
    const entity = nonToken.scenes[IDS.scene]?.entities[IDS.entity];
    if (entity) delete entity.token;
    expect(tokenSetElevation.permission(nonToken, ACTORS.host, payload)).toBe(false);
    const locked = stateWithToken();
    const scene = locked.scenes[IDS.scene];
    if (scene) scene.layers.tokens = { locked: true };
    expect(tokenSetElevation.permission(locked, ACTORS.host, payload)).toBe(false);
  });
});

describe(`${T} reducer and visibility`, () => {
  it('sets only position.y', () => {
    const before = stateWithToken();
    const result = reduceAction(before, envelope());
    const moved = result.state.scenes[IDS.scene]?.entities[IDS.entity];
    expect(moved?.transform.position).toEqual({ x: 3, y: 2, z: 4 });
    expect(before.scenes[IDS.scene]?.entities[IDS.entity]?.transform.position.y).toBe(0);
  });

  it('is deterministic', () => {
    expect(reduceAction(stateWithToken(), envelope())).toEqual(
      reduceAction(stateWithToken(), envelope()),
    );
  });

  it('does not leak a DM-layer change to players or spectators', () => {
    const before = stateWithToken();
    const entity = before.scenes[IDS.scene]?.entities[IDS.entity];
    if (entity) entity.layer = 'dm';
    const result = reduceAction(before, { ...envelope(), actor: ACTORS.host });
    for (const audience of [{ kind: 'seat', seatId: IDS.owner }, { kind: 'spectators' }] as const) {
      expect(patchesFor(audience, before, result.state, result.patches)).toEqual([]);
    }
  });
});
