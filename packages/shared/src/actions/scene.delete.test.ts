import { describe, expect, it } from 'vitest';
import { canPerform, reduceAction } from './run.js';
import { sceneDelete } from './scene.delete.js';
import { ACTORS, IDS, makeCampaign, permissionMatrix, testId } from './testing.js';
import { patchesFor, visibleTo } from '../visibility/index.js';
import type { ActionEnvelope } from './envelope.js';

const privateId = testId(20);
function campaign() {
  const state = makeCampaign();
  state.scenes[privateId] = {
    ...state.scenes[IDS.scene],
    id: privateId,
    name: 'SECRET-PRIVATE-SCENE',
    dmOnly: true,
  } as (typeof state.scenes)[string];
  return state;
}
const envelope: ActionEnvelope = {
  id: IDS.action,
  type: 'scene.delete',
  payload: { sceneId: IDS.scene },
  actor: ACTORS.host,
  campaignId: IDS.campaign,
  sessionId: IDS.session,
  seq: 1,
  ts: 1,
};

describe('UX-04 scene lifecycle', () => {
  it('validates deletion payloads and grants only the host permission', () => {
    expect(sceneDelete.schema.safeParse(envelope.payload).success).toBe(true);
    for (const payload of [{}, { sceneId: 'bad' }, { sceneId: IDS.scene, extra: true }])
      expect(sceneDelete.schema.safeParse(payload).success).toBe(false);
    expect(permissionMatrix(campaign(), 'scene.delete', envelope.payload)).toEqual({
      host: true,
      coDm: false,
      owner: false,
      otherSeat: false,
      spectator: false,
      mod: false,
    });
    expect(canPerform(makeCampaign(), ACTORS.host, 'scene.delete', envelope.payload)).toBe(false);
    expect(canPerform(campaign(), ACTORS.host, 'scene.delete', { sceneId: testId(22) })).toBe(
      false,
    );
  });
  it('deletes active to null deterministically without exposing a private fallback', () => {
    const before = campaign();
    const result = reduceAction(before, envelope);
    expect(result).toEqual(reduceAction(before, envelope));
    expect(before.scenes[IDS.scene]).toBeDefined();
    expect(result.state.activeSceneId).toBeNull();
    expect(Object.keys(result.state.scenes)).toEqual([privateId]);
    for (const audience of [{ kind: 'seat', seatId: IDS.owner }, { kind: 'spectators' }] as const) {
      expect(visibleTo(audience, result.state).scenes).toEqual({});
      expect(JSON.stringify(patchesFor(audience, before, result.state))).not.toContain(privateId);
      expect(JSON.stringify(visibleTo(audience, before))).not.toContain('SECRET-PRIVATE');
    }
    expect(
      visibleTo({ kind: 'seat', seatId: IDS.coDm }, result.state).scenes[privateId],
    ).toBeDefined();
    expect(canPerform(result.state, ACTORS.host, 'scene.delete', { sceneId: privateId })).toBe(
      false,
    );
  });
  it('filters private entity and scene edits from optimized raw patches', () => {
    const before = campaign();
    for (const action of [
      {
        type: 'entity.create',
        payload: {
          sceneId: privateId,
          entity: {
            layer: 'props',
            owners: [],
            transform: {
              position: { x: 0, y: 0, z: 0 },
              rotation: { x: 0, y: 0, z: 0, w: 1 },
              scale: { x: 1, y: 1, z: 1 },
            },
            shape: { kind: 'box', color: '#667788', walkable: false },
            id: testId(23),
            name: 'SECRET-PRIVATE-ENTITY',
          },
        },
      },
      { type: 'scene.rename', payload: { sceneId: privateId, name: 'SECRET-RENAMED' } },
    ]) {
      const result = reduceAction(before, { ...envelope, ...action });
      for (const audience of [
        { kind: 'seat', seatId: IDS.owner },
        { kind: 'spectators' },
      ] as const) {
        expect(patchesFor(audience, before, result.state, result.patches)).toEqual([]);
      }
      expect(
        patchesFor({ kind: 'seat', seatId: IDS.coDm }, before, result.state, result.patches).length,
      ).toBeGreaterThan(0);
    }
  });
  it('never activates a private scene; only the DM activates public scenes', () => {
    expect(canPerform(campaign(), ACTORS.host, 'scene.activate', { sceneId: privateId })).toBe(
      false,
    );
    expect(canPerform(campaign(), ACTORS.coDm, 'scene.activate', { sceneId: IDS.scene })).toBe(
      false,
    );
    const state = { ...makeCampaign(), activeSceneId: null };
    const privateScene = reduceAction(state, {
      ...envelope,
      type: 'scene.create',
      payload: { sceneId: privateId, name: 'Secret', dmOnly: true },
    }).state;
    expect(privateScene.activeSceneId).toBeNull();
    expect(
      canPerform(privateScene, { ...ACTORS.owner, identityId: IDS.identity }, 'session.join', {
        seatId: IDS.owner,
        identityId: IDS.identity,
      }),
    ).toBe(false);
    expect(
      canPerform(campaign(), ACTORS.owner, 'scene.rename', { sceneId: privateId, name: 'Guess' }),
    ).toBe(false);
  });
});
