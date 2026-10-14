import { describe, expect, it } from 'vitest';
import { patchesFor } from '../visibility/index.js';
import type { ActionEnvelope } from './envelope.js';
import { sceneCreate } from './scene.create.js';
import { reduceAction } from './run.js';
import { DEFAULT_SCENE_BACKGROUND } from '../schema/index.js';
import { ACTORS, IDS, makeCampaign, makeEntity, permissionMatrix, testId } from './testing.js';

const T = 'scene.create';
const payload: Record<string, unknown> = { sceneId: testId(20), name: 'Dragon Lair' };
const envelope = (p: unknown = payload): ActionEnvelope => ({
  id: IDS.action,
  type: T,
  payload: p,
  actor: ACTORS.host,
  campaignId: IDS.campaign,
  sessionId: IDS.session,
  seq: 1,
  ts: 1_000,
});

describe(`${T} schema`, () => {
  it('accepts a valid payload', () => {
    expect(sceneCreate.schema.safeParse(payload).success).toBe(true);
  });
  it.each([
    ['missing name', { sceneId: testId(20) }],
    ['empty name', { sceneId: testId(20), name: '  ' }],
    ['wrong type', { sceneId: testId(20), name: 5 }],
    ['bad id', { sceneId: 'nope', name: 'x' }],
    ['extra junk', { ...payload, extra: true }],
  ])('rejects %s', (_n, p) => {
    expect(sceneCreate.schema.safeParse(p).success).toBe(false);
  });
});

describe(`${T} permissions`, () => {
  it('allows host and co-DM only', () => {
    expect(permissionMatrix(makeCampaign(), T, payload)).toEqual({
      host: true,
      coDm: true,
      owner: false,
      otherSeat: false,
      spectator: false,
      mod: false,
    });
  });
  it('rejects a scene id that already exists', () => {
    expect(permissionMatrix(makeCampaign(), T, { ...payload, sceneId: IDS.scene }).host).toBe(
      false,
    );
  });
});

describe(`${T} reducer`, () => {
  it('adds a scene with default grid and keeps the active scene', () => {
    const before = makeCampaign();
    const { state, patches, inversePatches } = reduceAction(before, envelope());
    const scene = state.scenes[testId(20)];
    expect(scene).toMatchObject({
      name: 'Dragon Lair',
      grid: { sizePx: 70, unitsPerCell: 5, unitLabel: 'ft', diagonal: 'alternating', snap: true },
      environment: { background: DEFAULT_SCENE_BACKGROUND },
      entities: {},
    });
    expect(state.activeSceneId).toBe(IDS.scene);
    expect(before.scenes[testId(20)]).toBeUndefined();
    expect(patches).toHaveLength(1);
    expect(inversePatches).toEqual([{ op: 'remove', path: ['scenes', testId(20)] }]);
  });

  it('activates the scene when the campaign has none active', () => {
    const before = { ...makeCampaign(), activeSceneId: null };
    expect(reduceAction(before, envelope()).state.activeSceneId).toBe(testId(20));
  });

  it('honours an explicit background', () => {
    const { state } = reduceAction(makeCampaign(), envelope({ ...payload, background: '#112233' }));
    expect(state.scenes[testId(20)]?.environment.background).toBe('#112233');
  });

  it('is deterministic: same state + envelope gives identical results', () => {
    expect(reduceAction(makeCampaign(), envelope())).toEqual(
      reduceAction(makeCampaign(), envelope()),
    );
  });
});

describe(`${T} visibility`, () => {
  it('never sends DM-layer data to players or spectators', () => {
    const secretId = testId(10);
    const before = makeCampaign();
    const scene = before.scenes[IDS.scene];
    if (scene) scene.entities[secretId] = makeEntity(secretId, { layer: 'dm', name: 'SECRET-DM' });
    const { state } = reduceAction(before, envelope());
    const audiences = [
      { kind: 'seat', seatId: IDS.other },
      { kind: 'seat', seatId: IDS.owner },
      { kind: 'spectators' },
    ] as const;
    for (const a of audiences) {
      expect(JSON.stringify(patchesFor(a, before, state))).not.toContain('SECRET-DM');
    }
  });
});

describe(`${T} bounds (D37)`, () => {
  it('validates optional bounds as whole cells 1..200', () => {
    const ok = (b: unknown) => sceneCreate.schema.safeParse({ ...payload, bounds: b }).success;
    expect(ok({ width: 1, height: 200 })).toBe(true);
    expect(ok({ width: 0, height: 10 })).toBe(false);
    expect(ok({ width: 201, height: 10 })).toBe(false);
    expect(ok({ width: 10.5, height: 10 })).toBe(false);
    expect(ok({ width: 10 })).toBe(false);
  });
  it('stores bounds when given and omits them otherwise', () => {
    const withB = reduceAction(
      makeCampaign(),
      envelope({ ...payload, bounds: { width: 20, height: 15 } }),
    );
    expect(withB.state.scenes[testId(20)]?.bounds).toEqual({ width: 20, height: 15 });
    const without = reduceAction(makeCampaign(), envelope());
    expect(without.state.scenes[testId(20)]).not.toHaveProperty('bounds');
  });
});
