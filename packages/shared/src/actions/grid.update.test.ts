import { describe, expect, it } from 'vitest';
import { patchesFor } from '../visibility/index.js';
import type { ActionEnvelope } from './envelope.js';
import { gridUpdate } from './grid.update.js';
import { reduceAction } from './run.js';
import { ACTORS, IDS, makeCampaign, makeEntity, permissionMatrix, testId } from './testing.js';

const T = 'grid.update';
const payload: Record<string, unknown> = {
  sceneId: IDS.scene,
  sizePx: 100,
  unitsPerCell: 10,
  unitLabel: 'm',
  diagonal: 'chebyshev',
  snap: false,
};
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
    expect(gridUpdate.schema.safeParse(payload).success).toBe(true);
  });
  it.each([
    ['no fields', { sceneId: IDS.scene }],
    ['zero size', { sceneId: IDS.scene, sizePx: 0 }],
    ['negative units', { sceneId: IDS.scene, unitsPerCell: -5 }],
    ['empty label', { sceneId: IDS.scene, unitLabel: ' ' }],
    ['bad diagonal', { sceneId: IDS.scene, diagonal: 'knight' }],
    ['wrong snap type', { sceneId: IDS.scene, snap: 'yes' }],
    ['bad id', { sceneId: 'nope', snap: true }],
    ['extra junk', { ...payload, extra: true }],
  ])('rejects %s', (_n, p) => {
    expect(gridUpdate.schema.safeParse(p).success).toBe(false);
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
  it('rejects an unknown scene even for the host', () => {
    expect(permissionMatrix(makeCampaign(), T, { ...payload, sceneId: IDS.entity }).host).toBe(
      false,
    );
  });
});

describe(`${T} reducer`, () => {
  it('updates every supplied grid field', () => {
    const { state } = reduceAction(makeCampaign(), envelope());
    expect(state.scenes[IDS.scene]?.grid).toEqual({
      type: 'square',
      sizePx: 100,
      unitsPerCell: 10,
      unitLabel: 'm',
      diagonal: 'chebyshev',
      snap: false,
    });
  });

  it('leaves unspecified fields alone and produces inverse patches', () => {
    const before = makeCampaign();
    const { state, inversePatches } = reduceAction(
      before,
      envelope({ sceneId: IDS.scene, snap: false }),
    );
    expect(state.scenes[IDS.scene]?.grid).toEqual({
      ...before.scenes[IDS.scene]?.grid,
      snap: false,
    });
    expect(inversePatches).toEqual([
      { op: 'replace', path: ['scenes', IDS.scene, 'grid', 'snap'], value: true },
    ]);
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
