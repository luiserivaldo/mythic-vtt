import { describe, expect, it } from 'vitest';
import { patchesFor } from '../visibility/index.js';
import type { ActionEnvelope } from './envelope.js';
import { entityUpdate } from './entity.update.js';
import { reduceAction } from './run.js';
import { ACTORS, IDS, makeCampaign, makeEntity, permissionMatrix } from './testing.js';

const T = 'entity.update';
const transform = {
  position: { x: 2, y: 0, z: 3 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: 1, y: 1, z: 1 },
};
const payload = { sceneId: IDS.scene, entityId: IDS.entity, changes: { transform } };
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
const stateWithEntity = () => {
  const state = makeCampaign();
  const scene = state.scenes[IDS.scene];
  if (scene) {
    scene.entities[IDS.entity] = makeEntity(IDS.entity, {
      owners: [IDS.owner],
      token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
    });
  }
  return state;
};

describe(`${T} schema`, () => {
  it('accepts changes and rejects empty, protected, malformed or extra fields', () => {
    expect(entityUpdate.schema.safeParse(payload).success).toBe(true);
    expect(entityUpdate.schema.safeParse({ ...payload, changes: {} }).success).toBe(false);
    expect(entityUpdate.schema.safeParse({ ...payload, changes: { owners: [] } }).success).toBe(
      false,
    );
    expect(entityUpdate.schema.safeParse({ ...payload, changes: { transform: 3 } }).success).toBe(
      false,
    );
    expect(
      entityUpdate.schema.safeParse({
        ...payload,
        changes: { pin: { text: 'x', reveal: 'click' } },
      }).success,
    ).toBe(false);
    expect(entityUpdate.schema.safeParse({ ...payload, extra: true }).success).toBe(false);
  });
});

describe(`${T} token colour (D38)`, () => {
  it('accepts a valid token colour change and rejects a malformed one', () => {
    const token = { sizeCells: 1, heightCells: 1, labelVisibility: 'all' };
    const changes = (color: string) => ({ ...payload, changes: { token: { ...token, color } } });
    expect(entityUpdate.schema.safeParse(changes('#336699')).success).toBe(true);
    expect(entityUpdate.schema.safeParse(changes('blue')).success).toBe(false);
  });
});

describe(`${T} permissions`, () => {
  it('lets admins and an owner with move permission transform an entity', () => {
    expect(permissionMatrix(stateWithEntity(), T, payload)).toEqual({
      host: true,
      owner: true,
      otherSeat: false,
      coDm: true,
      spectator: false,
      mod: false,
    });
  });

  it('requires edit for non-transform fields and supports explicit grants', () => {
    const state = stateWithEntity();
    const editPayload = { sceneId: IDS.scene, entityId: IDS.entity, changes: { name: 'Edited' } };
    expect(entityUpdate.permission(state, ACTORS.owner, editPayload)).toBe(false);
    const owner = state.seats[IDS.owner];
    if (owner) owner.permissions.edit = true;
    expect(entityUpdate.permission(state, ACTORS.owner, editPayload)).toBe(true);
    const other = state.seats[IDS.other];
    const entity = state.scenes[IDS.scene]?.entities[IDS.entity];
    if (other) other.permissions.edit = true;
    if (entity) entity.perms = { edit: true };
    expect(entityUpdate.permission(state, ACTORS.otherSeat, editPayload)).toBe(true);
  });

  it('rejects missing entities and locked layers', () => {
    expect(entityUpdate.permission(makeCampaign(), ACTORS.host, payload)).toBe(false);
    const state = stateWithEntity();
    const scene = state.scenes[IDS.scene];
    if (scene) scene.layers.tokens = { locked: true };
    expect(entityUpdate.permission(state, ACTORS.host, payload)).toBe(false);
  });
});

describe(`${T} reducer and visibility`, () => {
  it('updates deterministically without mutating the input', () => {
    const before = stateWithEntity();
    const result = reduceAction(before, envelope());
    expect(result.state.scenes[IDS.scene]?.entities[IDS.entity]?.transform).toEqual(transform);
    expect(before.scenes[IDS.scene]?.entities[IDS.entity]?.transform.position.x).toBe(0);
    expect(result).toEqual(reduceAction(stateWithEntity(), envelope()));
  });

  it('does not leak edits to a DM-layer entity', () => {
    const before = stateWithEntity();
    const entity = before.scenes[IDS.scene]?.entities[IDS.entity];
    if (entity) entity.layer = 'dm';
    const result = reduceAction(before, { ...envelope(), actor: ACTORS.host });
    for (const audience of [{ kind: 'seat', seatId: IDS.owner }, { kind: 'spectators' }] as const)
      expect(patchesFor(audience, before, result.state, result.patches)).toEqual([]);
  });
});

describe(`${T} bounds (D37)`, () => {
  const to = (x: number, z: number) => ({
    ...payload,
    changes: { transform: { ...transform, position: { x, y: 0, z } } },
  });
  it('accepts a move onto the edge and rejects one outside', () => {
    const state = stateWithEntity();
    const scene = state.scenes[IDS.scene];
    if (scene) scene.bounds = { width: 8, height: 6 };
    expect(entityUpdate.permission(state, ACTORS.owner, to(8, 6))).toBe(true);
    expect(entityUpdate.permission(state, ACTORS.owner, to(8.01, 6))).toBe(false);
    expect(entityUpdate.permission(state, ACTORS.host, to(0, -0.01))).toBe(false);
  });
  it('rejects outside the default 40 x 30 for scenes without bounds', () => {
    const state = stateWithEntity();
    expect(entityUpdate.permission(state, ACTORS.owner, to(40, 30))).toBe(true);
    expect(entityUpdate.permission(state, ACTORS.owner, to(41, 3))).toBe(false);
  });
});
