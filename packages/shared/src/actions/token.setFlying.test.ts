import { describe, expect, it } from 'vitest';
import { patchesFor } from '../visibility/index.js';
import type { ActionEnvelope } from './envelope.js';
import { reduceAction } from './run.js';
import { ACTORS, IDS, makeCampaign, makeEntity, permissionMatrix } from './testing.js';
import { tokenSetFlying } from './token.setFlying.js';

const T = 'token.setFlying';
const payload = { sceneId: IDS.scene, entityId: IDS.entity, flying: true };
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

const stateWithToken = (flying?: boolean) => {
  const state = makeCampaign();
  const scene = state.scenes[IDS.scene];
  if (scene) {
    scene.entities[IDS.entity] = makeEntity(IDS.entity, {
      owners: [IDS.owner],
      token: {
        sizeCells: 1,
        heightCells: 1,
        labelVisibility: 'all',
        ...(flying === undefined ? {} : { flying }),
      },
    });
    const entity = scene.entities[IDS.entity];
    if (entity) entity.transform.position = { x: 3, y: 2, z: 4 };
  }
  return state;
};

describe(`${T} schema`, () => {
  it('accepts a boolean flag and rejects anything else', () => {
    expect(tokenSetFlying.schema.safeParse(payload).success).toBe(true);
    expect(tokenSetFlying.schema.safeParse({ ...payload, flying: false }).success).toBe(true);
    for (const bad of [
      { sceneId: IDS.scene, entityId: IDS.entity },
      { ...payload, flying: 'yes' },
      { ...payload, flying: 1 },
      { ...payload, entityId: 7 },
      { ...payload, extra: true },
    ]) {
      expect(tokenSetFlying.schema.safeParse(bad).success).toBe(false);
    }
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
    expect(tokenSetFlying.permission(state, ACTORS.owner, payload)).toBe(false);
  });

  it('rejects missing entities, non-tokens and locked layers', () => {
    expect(tokenSetFlying.permission(makeCampaign(), ACTORS.host, payload)).toBe(false);
    const nonToken = stateWithToken();
    const entity = nonToken.scenes[IDS.scene]?.entities[IDS.entity];
    if (entity) delete entity.token;
    expect(tokenSetFlying.permission(nonToken, ACTORS.host, payload)).toBe(false);
    const locked = stateWithToken();
    const scene = locked.scenes[IDS.scene];
    if (scene) scene.layers.tokens = { locked: true };
    expect(tokenSetFlying.permission(locked, ACTORS.host, payload)).toBe(false);
  });
});

describe(`${T} reducer and visibility`, () => {
  it('sets the flag and leaves the position alone', () => {
    const before = stateWithToken();
    const result = reduceAction(before, envelope());
    const entity = result.state.scenes[IDS.scene]?.entities[IDS.entity];
    expect(entity?.token?.flying).toBe(true);
    expect(entity?.transform.position).toEqual({ x: 3, y: 2, z: 4 });
    expect(before.scenes[IDS.scene]?.entities[IDS.entity]?.token?.flying).toBeUndefined();
  });

  it('clears the flag by removing it, not by storing false', () => {
    const result = reduceAction(stateWithToken(true), envelope({ ...payload, flying: false }));
    const token = result.state.scenes[IDS.scene]?.entities[IDS.entity]?.token;
    expect(token).toBeDefined();
    expect(token && 'flying' in token).toBe(false);
  });

  it('is idempotent', () => {
    const once = reduceAction(stateWithToken(), envelope());
    const twice = reduceAction(once.state, envelope());
    expect(twice.state).toEqual(once.state);
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
