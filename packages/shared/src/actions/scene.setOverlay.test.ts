import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Campaign, patchesFor, reduceAction, SceneOverlay, type ActionEnvelope } from '../index.js';
import { ACTORS, IDS, makeCampaign, makeEntity, permissionMatrix } from './testing.js';
import { sceneSetOverlay } from './scene.setOverlay.js';

const overlay = { tint: '#8090ff', tintOpacity: 0.2, darkness: 0.3 };
const payload = { sceneId: IDS.scene, overlay };
const action: ActionEnvelope = {
  id: IDS.action,
  type: 'scene.setOverlay',
  payload,
  actor: ACTORS.host,
  campaignId: IDS.campaign,
  sessionId: IDS.session,
  seq: 1,
  ts: 1000,
};
describe('scene filters', () => {
  it('validates strict bounded payloads and allows only host/co-DM', () => {
    expect(sceneSetOverlay.schema.safeParse(payload).success).toBe(true);
    expect(sceneSetOverlay.schema.safeParse({ ...payload, extra: true }).success).toBe(false);
    for (const invalid of [
      { ...overlay, tint: 'red' },
      { ...overlay, darkness: 1 },
      { ...overlay, tintOpacity: -1 },
      { ...overlay, darkness: Number.NaN },
      { ...overlay, extra: true },
    ])
      expect(SceneOverlay.safeParse(invalid).success).toBe(false);
    expect(permissionMatrix(makeCampaign(), action.type, payload)).toEqual({
      host: true,
      coDm: true,
      owner: false,
      otherSeat: false,
      spectator: false,
      mod: false,
    });
    expect(
      sceneSetOverlay.permission(makeCampaign(), ACTORS.host, { ...payload, sceneId: IDS.other }),
    ).toBe(false);
  });
  it('preserves visible entities and hidden privacy, round-trips and clears the component', () => {
    const before = makeCampaign();
    const scene = before.scenes[IDS.scene];
    if (!scene) throw new Error('scene');
    scene.entities[IDS.entity] = makeEntity(IDS.entity, { layer: 'dm', name: 'Secret' });
    const result = reduceAction(before, action);
    expect(result).toEqual(reduceAction(before, action));
    expect(before.scenes[IDS.scene]?.overlay).toBeUndefined();
    expect(
      Campaign.parse(JSON.parse(JSON.stringify(result.state))).scenes[IDS.scene]?.overlay,
    ).toEqual(overlay);
    const player = patchesFor({ kind: 'spectators' }, before, result.state);
    expect(JSON.stringify(player)).not.toContain('Secret');
    expect(JSON.stringify(player)).not.toContain(IDS.entity);
    expect(JSON.stringify(player)).toContain('overlay');
    expect(
      reduceAction(result.state, { ...action, payload: { sceneId: IDS.scene, overlay: null } })
        .state.scenes[IDS.scene]?.overlay,
    ).toBeUndefined();
  });
  it('never lets combined washes become opaque', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 0.35, noNaN: true }),
        fc.double({ min: 0, max: 0.5, noNaN: true }),
        (tintOpacity, darkness) => {
          expect(SceneOverlay.safeParse({ ...overlay, tintOpacity, darkness }).success).toBe(true);
          expect((1 - tintOpacity) * (1 - darkness)).toBeGreaterThanOrEqual(0.325);
        },
      ),
    );
  });
});
