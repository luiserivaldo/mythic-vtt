import { describe, expect, it } from 'vitest';
import { patchesFor } from '../visibility/index.js';
import type { ActionEnvelope } from './envelope.js';
import { sceneUpdate } from './scene.update.js';
import { reduceAction } from './run.js';
import { ACTORS, IDS, makeCampaign, makeEntity, permissionMatrix, testId } from './testing.js';

const T = 'scene.update';
const payload: Record<string, unknown> = {
  sceneId: IDS.scene,
  name: 'Dragon Lair',
  background: '#222222',
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
    expect(sceneUpdate.schema.safeParse(payload).success).toBe(true);
  });
  it('accepts the skybox alone, null to clear, and rejects a malformed asset', () => {
    const asset = { source: 'local', hash: 'a'.repeat(64), kind: 'image' };
    expect(sceneUpdate.schema.safeParse({ sceneId: IDS.scene, skybox: asset }).success).toBe(true);
    expect(sceneUpdate.schema.safeParse({ sceneId: IDS.scene, skybox: null }).success).toBe(true);
    expect(
      sceneUpdate.schema.safeParse({
        sceneId: IDS.scene,
        skybox: { source: 'local', hash: 'not-a-hash', kind: 'image' },
      }).success,
    ).toBe(false);
  });
  it.each([
    ['no fields', { sceneId: IDS.scene }],
    ['empty name', { sceneId: IDS.scene, name: '  ' }],
    ['wrong type', { sceneId: IDS.scene, background: 5 }],
    ['bad id', { sceneId: 'nope', name: 'x' }],
    ['extra junk', { ...payload, extra: true }],
  ])('rejects %s', (_n, p) => {
    expect(sceneUpdate.schema.safeParse(p).success).toBe(false);
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
  it('updates only the supplied fields, with inverse patches', () => {
    const before = makeCampaign();
    const { state, inversePatches } = reduceAction(
      before,
      envelope({ sceneId: IDS.scene, name: 'Lair' }),
    );
    expect(state.scenes[IDS.scene]?.name).toBe('Lair');
    expect(state.scenes[IDS.scene]?.environment.background).toBe('#000000');
    expect(before.scenes[IDS.scene]?.name).toBe('Cave');
    expect(inversePatches).toEqual([
      { op: 'replace', path: ['scenes', IDS.scene, 'name'], value: 'Cave' },
    ]);
  });

  it('updates name and background together', () => {
    const { state } = reduceAction(makeCampaign(), envelope());
    expect(state.scenes[IDS.scene]).toMatchObject({
      name: 'Dragon Lair',
      environment: { background: '#222222' },
    });
  });

  it('sets and clears the optional zenith gradient colour', () => {
    const set = reduceAction(makeCampaign(), envelope({ sceneId: IDS.scene, zenith: '#112233' }));
    expect(set.state.scenes[IDS.scene]?.environment).toEqual({
      background: '#000000',
      zenith: '#112233',
    });
    const cleared = reduceAction(set.state, envelope({ sceneId: IDS.scene, zenith: null }));
    expect(cleared.state.scenes[IDS.scene]?.environment).toEqual({ background: '#000000' });
  });

  it('sets and clears the optional image skybox, leaving the colours alone (ENV-07)', () => {
    const asset = { source: 'local', hash: 'a'.repeat(64), kind: 'image', name: 'sky.png' };
    const set = reduceAction(makeCampaign(), envelope({ sceneId: IDS.scene, skybox: asset }));
    expect(set.state.scenes[IDS.scene]?.environment).toEqual({
      background: '#000000',
      skybox: asset,
    });
    // A colour-only update must not drop the image.
    const recoloured = reduceAction(
      set.state,
      envelope({ sceneId: IDS.scene, background: '#112233' }),
    );
    expect(recoloured.state.scenes[IDS.scene]?.environment).toEqual({
      background: '#112233',
      skybox: asset,
    });
    const cleared = reduceAction(recoloured.state, envelope({ sceneId: IDS.scene, skybox: null }));
    expect(cleared.state.scenes[IDS.scene]?.environment).toEqual({ background: '#112233' });
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
  it('accepts bounds alone and rejects invalid ones', () => {
    const ok = (b: unknown) =>
      sceneUpdate.schema.safeParse({ sceneId: IDS.scene, bounds: b }).success;
    expect(ok({ width: 30, height: 20 })).toBe(true);
    expect(ok({ width: 0, height: 20 })).toBe(false);
    expect(ok({ width: 30, height: 201 })).toBe(false);
  });
  it('sets bounds and keeps host/co-DM-only permission', () => {
    const p = { sceneId: IDS.scene, bounds: { width: 30, height: 20 } };
    expect(permissionMatrix(makeCampaign(), T, p)).toMatchObject({
      host: true,
      coDm: true,
      owner: false,
    });
    const { state } = reduceAction(makeCampaign(), envelope(p));
    expect(state.scenes[IDS.scene]?.bounds).toEqual({ width: 30, height: 20 });
  });
});
