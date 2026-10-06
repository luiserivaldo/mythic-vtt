import { describe, expect, it } from 'vitest';
import { patchesFor } from '../visibility/index.js';
import type { ActionEnvelope } from './envelope.js';
import { reduceAction } from './run.js';
import { ACTORS, IDS, makeCampaign, makeEntity, permissionMatrix } from './testing.js';
import { tokenMove } from './token.move.js';

const T = 'token.move';
const to = { x: 2.25, y: 1.5, z: 3.75 };
const payload = { sceneId: IDS.scene, entityId: IDS.entity, to };
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
      token: { sizeCells: 2, heightCells: 2, labelVisibility: 'all' },
    });
  }
  return state;
};

describe(`${T} schema`, () => {
  it('accepts a valid destination and rejects missing, malformed or extra data', () => {
    expect(tokenMove.schema.safeParse(payload).success).toBe(true);
    expect(tokenMove.schema.safeParse({ sceneId: IDS.scene, entityId: IDS.entity }).success).toBe(
      false,
    );
    expect(tokenMove.schema.safeParse({ ...payload, entityId: 7 }).success).toBe(false);
    expect(tokenMove.schema.safeParse({ ...payload, to: { x: 1, y: 2 } }).success).toBe(false);
    expect(tokenMove.schema.safeParse({ ...payload, to: { ...to, x: Infinity } }).success).toBe(
      false,
    );
    expect(tokenMove.schema.safeParse({ ...payload, extra: true }).success).toBe(false);
  });
});

describe(`${T} permissions`, () => {
  it('allows admins and the owner, but denies other seats, spectators and mods', () => {
    expect(permissionMatrix(stateWithToken(), T, payload)).toEqual({
      host: true,
      owner: true,
      otherSeat: false,
      coDm: true,
      spectator: false,
      mod: false,
    });
  });

  it('allows a player with an explicit entity move grant', () => {
    const state = stateWithToken();
    const entity = state.scenes[IDS.scene]?.entities[IDS.entity];
    if (entity) {
      entity.owners = [];
      entity.perms = { move: true };
    }
    expect(tokenMove.permission(state, ACTORS.otherSeat, payload)).toBe(true);
  });

  it('requires the seat move capability even for an owner', () => {
    const state = stateWithToken();
    const owner = state.seats[IDS.owner];
    if (owner) owner.permissions.move = false;
    expect(tokenMove.permission(state, ACTORS.owner, payload)).toBe(false);
  });

  it('rejects missing entities, non-token entities and locked layers', () => {
    expect(tokenMove.permission(makeCampaign(), ACTORS.host, payload)).toBe(false);

    const nonToken = stateWithToken();
    const entity = nonToken.scenes[IDS.scene]?.entities[IDS.entity];
    if (entity) delete entity.token;
    expect(tokenMove.permission(nonToken, ACTORS.host, payload)).toBe(false);

    const locked = stateWithToken();
    const scene = locked.scenes[IDS.scene];
    if (scene) scene.layers.tokens = { locked: true };
    expect(tokenMove.permission(locked, ACTORS.host, payload)).toBe(false);
  });
});

describe(`${T} bounds (D37)`, () => {
  const at = (x: number, z: number) => ({ ...payload, to: { x, y: 0, z } });
  const withBounds = (width: number, height: number) => {
    const state = stateWithToken();
    const scene = state.scenes[IDS.scene];
    if (scene) scene.bounds = { width, height };
    return state;
  };

  it('accepts inside and on the edge, rejects outside', () => {
    const state = withBounds(8, 6);
    expect(tokenMove.permission(state, ACTORS.host, at(4, 3))).toBe(true);
    expect(tokenMove.permission(state, ACTORS.host, at(0, 0))).toBe(true);
    expect(tokenMove.permission(state, ACTORS.host, at(8, 6))).toBe(true);
    expect(tokenMove.permission(state, ACTORS.host, at(8.01, 3))).toBe(false);
    expect(tokenMove.permission(state, ACTORS.host, at(4, -0.01))).toBe(false);
    expect(tokenMove.permission(state, ACTORS.host, at(-1, 3))).toBe(false);
    expect(tokenMove.permission(state, ACTORS.host, at(4, 7))).toBe(false);
  });

  it('uses the 40 x 30 default for scenes without bounds', () => {
    const state = stateWithToken();
    expect(tokenMove.permission(state, ACTORS.host, at(40, 30))).toBe(true);
    expect(tokenMove.permission(state, ACTORS.host, at(41, 30))).toBe(false);
    expect(tokenMove.permission(state, ACTORS.host, at(40, 31))).toBe(false);
  });
});

describe(`${T} reducer and visibility`, () => {
  it('moves only the token position, preserving an unsnapped client destination', () => {
    const before = stateWithToken();
    const original = before.scenes[IDS.scene]?.entities[IDS.entity];
    const result = reduceAction(before, envelope());
    const moved = result.state.scenes[IDS.scene]?.entities[IDS.entity];

    expect(moved?.transform.position).toEqual(to);
    expect(moved?.transform.rotation).toEqual(original?.transform.rotation);
    expect(moved?.transform.scale).toEqual(original?.transform.scale);
    expect(before.scenes[IDS.scene]?.entities[IDS.entity]?.transform.position).toEqual({
      x: 0,
      y: 0,
      z: 0,
    });
  });

  it('is deterministic for the same state and envelope', () => {
    expect(reduceAction(stateWithToken(), envelope())).toEqual(
      reduceAction(stateWithToken(), envelope()),
    );
  });

  it('does not leak a hidden-layer move to players or spectators', () => {
    const before = stateWithToken();
    const entity = before.scenes[IDS.scene]?.entities[IDS.entity];
    if (entity) entity.layer = 'dm';
    const result = reduceAction(before, { ...envelope(), actor: ACTORS.host });

    for (const audience of [{ kind: 'seat', seatId: IDS.owner }, { kind: 'spectators' }] as const) {
      expect(patchesFor(audience, before, result.state, result.patches)).toEqual([]);
    }
  });
});
