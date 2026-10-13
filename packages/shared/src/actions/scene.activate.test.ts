import { describe, expect, it } from 'vitest';
import { patchesFor } from '../visibility/index.js';
import type { ActionEnvelope } from './envelope.js';
import { sceneActivate } from './scene.activate.js';
import { reduceAction } from './run.js';
import { ACTORS, IDS, makeCampaign, makeEntity, permissionMatrix, testId } from './testing.js';

const T = 'scene.activate';
const payload: Record<string, unknown> = { sceneId: IDS.scene };
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
    expect(sceneActivate.schema.safeParse(payload).success).toBe(true);
  });
  it.each([
    ['missing id', {}],
    ['wrong type', { sceneId: 5 }],
    ['bad id', { sceneId: 'nope' }],
    ['extra junk', { ...payload, extra: true }],
  ])('rejects %s', (_n, p) => {
    expect(sceneActivate.schema.safeParse(p).success).toBe(false);
  });
});

describe(`${T} permissions`, () => {
  it('allows only the host', () => {
    expect(permissionMatrix(makeCampaign(), T, payload)).toEqual({
      host: true,
      coDm: false,
      owner: false,
      otherSeat: false,
      spectator: false,
      mod: false,
    });
  });
  it('rejects an unknown scene even for the host', () => {
    expect(permissionMatrix(makeCampaign(), T, { sceneId: testId(21) }).host).toBe(false);
  });
});

describe(`${T} reducer`, () => {
  it('switches the active scene', () => {
    const before = makeCampaign();
    const cave = before.scenes[IDS.scene];
    if (cave) before.scenes[testId(20)] = { ...structuredClone(cave), id: testId(20) };
    const { state, patches, inversePatches } = reduceAction(
      before,
      envelope({ sceneId: testId(20) }),
    );
    expect(state.activeSceneId).toBe(testId(20));
    expect(patches).toEqual([{ op: 'replace', path: ['activeSceneId'], value: testId(20) }]);
    expect(inversePatches).toEqual([{ op: 'replace', path: ['activeSceneId'], value: IDS.scene }]);
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
