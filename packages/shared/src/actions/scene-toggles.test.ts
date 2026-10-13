import { describe, expect, it } from 'vitest';
import {
  Campaign,
  DEFAULT_PLAYER_TOGGLES,
  reduceAction,
  resolvePlayerToggles,
  visibleTo,
  type ActionEnvelope,
} from '../index.js';
import { ACTORS, IDS, makeCampaign, makeEntity, permissionMatrix } from './testing.js';
import { canUseSceneToggle, TOGGLE_FOR_CHANNEL } from './scene-toggles.js';
import { sceneSetPlayerToggles } from './scene.setPlayerToggles.js';
import { DRAW_CLEAR_CHANNEL, DRAW_ERASE_CHANNEL, DRAW_STROKE_CHANNEL } from '../drawing.js';

const payload = { sceneId: IDS.scene, toggles: { draw: true, measure: false } };
const envelope: ActionEnvelope = {
  id: IDS.action,
  type: 'scene.setPlayerToggles',
  payload,
  actor: ACTORS.host,
  campaignId: IDS.campaign,
  sessionId: IDS.session,
  seq: 1,
  ts: 1000,
};

function withToggles(toggles: Record<string, boolean>) {
  const state = makeCampaign();
  const scene = state.scenes[IDS.scene];
  if (!scene) throw new Error('scene');
  scene.playerToggles = toggles;
  return state;
}

describe('scene player toggles (PERM-05)', () => {
  it('gates live drawing on the scene draw toggle; erase and clear are host-enforced', () => {
    expect(TOGGLE_FOR_CHANNEL[DRAW_STROKE_CHANNEL]).toBe('draw');
    expect(TOGGLE_FOR_CHANNEL['ruler.preview']).toBe('measure');
    // Erasing is ownership and clearing is role: neither is a scene-wide player permission.
    expect(TOGGLE_FOR_CHANNEL[DRAW_ERASE_CHANNEL]).toBeUndefined();
    expect(TOGGLE_FOR_CHANNEL[DRAW_CLEAR_CHANNEL]).toBeUndefined();
  });

  it('defaults keep measuring open and drawing/pins closed for scenes without toggles', () => {
    const state = makeCampaign();
    expect(state.scenes[IDS.scene]?.playerToggles).toBeUndefined();
    expect(resolvePlayerToggles({})).toEqual(DEFAULT_PLAYER_TOGGLES);
    expect(canUseSceneToggle(state, ACTORS.owner, IDS.scene, 'measure')).toBe(true);
    expect(canUseSceneToggle(state, ACTORS.owner, IDS.scene, 'draw')).toBe(false);
    expect(canUseSceneToggle(state, ACTORS.owner, IDS.scene, 'pins')).toBe(false);
  });

  it('a disabled toggle rejects players while the host and co-DM are unaffected', () => {
    const state = withToggles({ draw: false, measure: false, pins: false });
    for (const toggle of ['draw', 'measure', 'pins'] as const) {
      expect(canUseSceneToggle(state, ACTORS.host, IDS.scene, toggle)).toBe(true);
      expect(canUseSceneToggle(state, ACTORS.coDm, IDS.scene, toggle)).toBe(true);
      expect(canUseSceneToggle(state, ACTORS.owner, IDS.scene, toggle)).toBe(false);
      expect(canUseSceneToggle(state, ACTORS.otherSeat, IDS.scene, toggle)).toBe(false);
    }
  });

  it('an enabled toggle allows players but never spectators, mods or unknown scenes', () => {
    const state = withToggles({ draw: true, measure: true, pins: true });
    expect(canUseSceneToggle(state, ACTORS.owner, IDS.scene, 'draw')).toBe(true);
    expect(canUseSceneToggle(state, ACTORS.spectator, IDS.scene, 'draw')).toBe(false);
    expect(canUseSceneToggle(state, ACTORS.mod, IDS.scene, 'draw')).toBe(false);
    expect(canUseSceneToggle(state, ACTORS.owner, IDS.other, 'draw')).toBe(false);
    expect(canUseSceneToggle(state, ACTORS.host, IDS.other, 'draw')).toBe(false);
  });

  it('composes with the seat switch: both must allow, and the seat switch binds co-DMs too', () => {
    const state = withToggles({ draw: true });
    const owner = state.seats[IDS.owner];
    const coDm = state.seats[IDS.coDm];
    if (!owner || !coDm) throw new Error('seats');
    owner.interactionEnabled = false;
    coDm.interactionEnabled = false;
    expect(canUseSceneToggle(state, ACTORS.owner, IDS.scene, 'draw')).toBe(false);
    expect(canUseSceneToggle(state, ACTORS.coDm, IDS.scene, 'draw')).toBe(false);
    expect(canUseSceneToggle(state, ACTORS.host, IDS.scene, 'draw')).toBe(true);
    owner.interactionEnabled = true;
    const scene = state.scenes[IDS.scene];
    if (!scene) throw new Error('scene');
    scene.playerToggles = { draw: false };
    expect(canUseSceneToggle(state, ACTORS.owner, IDS.scene, 'draw')).toBe(false);
  });

  it('scene.setPlayerToggles is host/co-DM only, strict and non-empty', () => {
    expect(permissionMatrix(makeCampaign(), envelope.type, payload)).toEqual({
      host: true,
      coDm: true,
      owner: false,
      otherSeat: false,
      spectator: false,
      mod: false,
    });
    expect(sceneSetPlayerToggles.schema.safeParse(payload).success).toBe(true);
    for (const bad of [
      { sceneId: IDS.scene, toggles: {} },
      { sceneId: IDS.scene, toggles: { draw: 'yes' } },
      { sceneId: IDS.scene, toggles: { fly: true } },
      { ...payload, extra: 1 },
    ])
      expect(sceneSetPlayerToggles.schema.safeParse(bad).success).toBe(false);
    expect(
      sceneSetPlayerToggles.permission(makeCampaign(), ACTORS.host, {
        ...payload,
        sceneId: IDS.other,
      }),
    ).toBe(false);
  });

  it('merges partial changes, is deterministic and round-trips through the schema', () => {
    const before = withToggles({ pins: true });
    const result = reduceAction(before, envelope);
    expect(result).toEqual(reduceAction(before, envelope));
    expect(before.scenes[IDS.scene]?.playerToggles).toEqual({ pins: true });
    const parsed = Campaign.parse(JSON.parse(JSON.stringify(result.state)));
    expect(parsed.scenes[IDS.scene]?.playerToggles).toEqual({
      pins: true,
      draw: true,
      measure: false,
    });
  });

  it('never leaks a DM-only scene or its toggles to players or spectators', () => {
    const state = withToggles({ draw: true });
    const scene = state.scenes[IDS.scene];
    if (!scene) throw new Error('scene');
    scene.dmOnly = true;
    scene.entities[IDS.entity] = makeEntity(IDS.entity, { layer: 'dm', name: 'Secret' });
    for (const audience of [{ kind: 'seat', seatId: IDS.owner }, { kind: 'spectators' }] as const) {
      const json = JSON.stringify(visibleTo(audience, state));
      expect(json).not.toContain('playerToggles');
      expect(json).not.toContain('Secret');
    }
  });
});
