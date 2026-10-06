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

describe(`${T} primitives (ENV-02, D23)`, () => {
  const shape = (kind: string) =>
    makeEntity(createdId, {
      layer: 'props',
      shape: { kind, color: '#336699', walkable: true },
    } as never);

  it('accepts every primitive kind and stores the shape component', () => {
    for (const kind of ['box', 'cylinder', 'cone', 'pyramid', 'sphere', 'plane', 'wedge']) {
      const p = { sceneId: IDS.scene, entity: shape(kind) };
      expect(entityCreate.schema.safeParse(p).success).toBe(true);
      expect(entityCreate.permission(makeCampaign(), ACTORS.host, p)).toBe(true);
      expect(entityCreate.permission(makeCampaign(), ACTORS.otherSeat, p)).toBe(false);
    }
  });

  it('rejects unknown kinds and a missing walkable flag', () => {
    expect(
      entityCreate.schema.safeParse({ sceneId: IDS.scene, entity: shape('torus') }).success,
    ).toBe(false);
    const bad = { ...shape('box'), shape: { kind: 'box', color: '#fff' } };
    expect(entityCreate.schema.safeParse({ sceneId: IDS.scene, entity: bad }).success).toBe(false);
  });
});

describe(`${T} bounds (D37)`, () => {
  const at = (x: number, z: number) => ({
    ...payload,
    entity: makeEntity(createdId, {
      transform: {
        position: { x, y: 0, z },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
      },
    }),
  });
  it('accepts the default-bounds edge and rejects just outside it', () => {
    expect(entityCreate.permission(makeCampaign(), ACTORS.host, at(40, 30))).toBe(true);
    expect(entityCreate.permission(makeCampaign(), ACTORS.host, at(0, 0))).toBe(true);
    expect(entityCreate.permission(makeCampaign(), ACTORS.host, at(40.5, 3))).toBe(false);
    expect(entityCreate.permission(makeCampaign(), ACTORS.host, at(3, -1))).toBe(false);
  });
  it('uses the scene bounds when set', () => {
    const state = makeCampaign();
    const scene = state.scenes[IDS.scene];
    if (scene) scene.bounds = { width: 10, height: 5 };
    expect(entityCreate.permission(state, ACTORS.host, at(10, 5))).toBe(true);
    expect(entityCreate.permission(state, ACTORS.host, at(11, 5))).toBe(false);
  });
});
