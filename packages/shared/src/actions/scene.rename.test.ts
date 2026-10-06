import { describe, expect, it } from 'vitest';
import type { ActionEnvelope } from './envelope.js';
import { checkIntent, reduceAction } from './run.js';
import { sceneRename } from './scene.rename.js';
import { ACTORS, IDS, makeCampaign, permissionMatrix } from './testing.js';

const payload = { sceneId: IDS.scene, name: 'Dragon Lair' };
const envelope = (p: unknown = payload): ActionEnvelope => ({
  id: IDS.action,
  type: 'scene.rename',
  payload: p,
  actor: ACTORS.host,
  campaignId: IDS.campaign,
  sessionId: IDS.session,
  seq: 1,
  ts: 1_000,
});

describe('scene.rename schema', () => {
  it('accepts a valid payload', () => {
    expect(sceneRename.schema.safeParse(payload).success).toBe(true);
  });
  it.each([
    ['missing name', { sceneId: IDS.scene }],
    ['empty name', { sceneId: IDS.scene, name: '   ' }],
    ['wrong type', { sceneId: IDS.scene, name: 5 }],
    ['bad id', { sceneId: 'nope', name: 'x' }],
    ['extra junk', { ...payload, extra: true }],
  ])('rejects %s', (_n, p) => {
    expect(sceneRename.schema.safeParse(p).success).toBe(false);
  });
});

describe('scene.rename permissions', () => {
  it('allows host and co-DM only', () => {
    expect(permissionMatrix(makeCampaign(), 'scene.rename', payload)).toEqual({
      host: true,
      coDm: true,
      owner: false,
      otherSeat: false,
      spectator: false,
      mod: false,
    });
  });
  it('rejects an unknown scene even for the host', () => {
    const r = checkIntent(makeCampaign(), ACTORS.host, 'scene.rename', {
      sceneId: IDS.entity,
      name: 'x',
    });
    expect(r).toMatchObject({ ok: false, reason: 'forbidden' });
  });
});

describe('pipeline checks', () => {
  it('reports unknown actions and invalid payloads distinctly', () => {
    const s = makeCampaign();
    expect(checkIntent(s, ACTORS.host, 'nope.nope', {})).toMatchObject({
      reason: 'unknown-action',
    });
    expect(checkIntent(s, ACTORS.host, 'scene.rename', {})).toMatchObject({
      reason: 'invalid-payload',
    });
  });
});

describe('scene.rename reducer', () => {
  it('renames the scene and produces patches with inverses', () => {
    const before = makeCampaign();
    const { state, patches, inversePatches } = reduceAction(before, envelope());
    expect(state.scenes[IDS.scene]?.name).toBe('Dragon Lair');
    expect(before.scenes[IDS.scene]?.name).toBe('Cave'); // input not mutated
    expect(patches).toEqual([
      { op: 'replace', path: ['scenes', IDS.scene, 'name'], value: 'Dragon Lair' },
    ]);
    expect(inversePatches).toEqual([
      { op: 'replace', path: ['scenes', IDS.scene, 'name'], value: 'Cave' },
    ]);
  });

  it('is deterministic: same state + envelope gives identical results', () => {
    const a = reduceAction(makeCampaign(), envelope());
    const b = reduceAction(makeCampaign(), envelope());
    expect(a).toEqual(b);
  });

  it('throws on an unknown action type', () => {
    expect(() => reduceAction(makeCampaign(), { ...envelope(), type: 'x.y' })).toThrow();
  });
});

// Visibility test: scene.rename touches no entity data, so there is nothing hidden to leak.
// The per-audience filter and its non-leak tests arrive with M0-05 (PERM-03).
