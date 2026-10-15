import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@mythic/protocol';
import type { Campaign } from '@mythic/shared';
import { buildJoinPayload } from './join-payload.js';
import { SECRETS, T, fixtureCampaign, tid } from './testing.js';

const TEMP = tid(21);
const ARCHIVED = tid(22);
const HIDDEN_SCENE = tid(23);

/** The fixture plus everything a pre-join visitor must never learn about. */
function campaignWithSecrets(): Campaign {
  const state = fixtureCampaign();
  state.name = 'The Sunken Chapel';
  state.icon = { kind: 'glyph', value: 'S' };
  state.screenshot = 'e'.repeat(64);
  const seatA = state.seats[T.seatA];
  if (seatA) seatA.icon = { kind: 'image', hash: 'f'.repeat(64) };
  state.seats[TEMP] = {
    id: TEMP,
    label: 'TEMP-SEAT-LABEL',
    binding: 'session',
    identityId: T.carol,
    role: 'player',
    permissions: { view: true, move: true, edit: false, delete: false },
    temporary: true,
  };
  state.seats[ARCHIVED] = {
    id: ARCHIVED,
    label: 'ARCHIVED-LABEL',
    binding: 'persistent',
    identityId: T.bob,
    role: 'player',
    permissions: { view: true, move: true, edit: true, delete: true },
    archived: true,
  };
  state.scenes[HIDDEN_SCENE] = {
    ...(state.scenes[T.scene] as NonNullable<Campaign['scenes'][string]>),
    id: HIDDEN_SCENE,
    name: 'DM-ONLY-SCENE-NAME',
    dmOnly: true,
    entities: {},
  };
  return state;
}

describe('buildJoinPayload (PERM-03: a joiner sees only what the link shows)', () => {
  it('lists exactly the allowed fields, and nothing from the campaign body', () => {
    const payload = buildJoinPayload(campaignWithSecrets(), { name: 'Dungeon Master' });
    expect(Object.keys(payload).sort()).toEqual([
      'campaign',
      'host',
      'protocol',
      'sceneActive',
      'seats',
    ]);
    expect(payload.protocol).toBe(PROTOCOL_VERSION);
    expect(payload.host).toEqual({ name: 'Dungeon Master' });
    expect(payload.campaign).toEqual({
      title: 'The Sunken Chapel',
      icon: { kind: 'glyph', value: 'S' },
      screenshot: 'e'.repeat(64),
    });
    expect(payload.sceneActive).toBe(true);
    for (const seat of payload.seats)
      expect(Object.keys(seat).sort()).toEqual(
        seat.icon
          ? ['claim', 'icon', 'label', 'role', 'seatId']
          : ['claim', 'label', 'role', 'seatId'],
      );
  });

  it('shows permanent seats with their claim state and hides everything else', () => {
    const payload = buildJoinPayload(campaignWithSecrets(), undefined);
    expect(payload.seats.map((s) => [s.label, s.role, s.claim])).toEqual([
      ['A', 'player', 'claimed'],
      ['B', 'player', 'free'],
    ]);
    expect(payload.seats[0]?.icon).toEqual({ kind: 'image', hash: 'f'.repeat(64) });
    const wire = JSON.stringify(payload);
    // Temporary and archived seats, identities, DM content, hidden scenes and permissions.
    for (const leak of [
      ...SECRETS,
      'TEMP-SEAT-LABEL',
      'ARCHIVED-LABEL',
      'DM-ONLY-SCENE-NAME',
      'Cave',
      'Goblin',
      T.alice,
      T.bob,
      T.carol,
      T.host,
      'permissions',
      'identityId',
      'binding',
      'spectator',
      TEMP,
      ARCHIVED,
    ])
      expect(wire).not.toContain(leak);
  });

  it('never offers a co-DM seat, free or held: only the host grants one (MV-269)', () => {
    const state = campaignWithSecrets();
    const free = buildJoinPayload(state, undefined);
    const coDm = state.seats[T.coDm];
    if (coDm) coDm.identityId = T.carol;
    for (const payload of [free, buildJoinPayload(state, undefined)]) {
      expect(payload.seats.some((s) => s.role === 'codm')).toBe(false);
      expect(JSON.stringify(payload)).not.toContain(T.coDm);
    }
  });

  it('never lists an archived seat as taken, and says so when no scene is active (F36)', () => {
    const state = campaignWithSecrets();
    state.activeSceneId = null;
    const payload = buildJoinPayload(state, { name: '  ' });
    expect(payload.sceneActive).toBe(false);
    expect(payload.host.name).toBe('Game Master');
    expect(payload.seats.some((s) => s.seatId === ARCHIVED)).toBe(false);
    expect(payload.seats.filter((s) => s.claim === 'claimed')).toHaveLength(1);
  });

  it('carries the DM avatar only when one is stored', () => {
    expect(buildJoinPayload(fixtureCampaign(), { name: 'DM', avatar: 'D' }).host).toEqual({
      name: 'DM',
      avatar: 'D',
    });
    expect(buildJoinPayload(fixtureCampaign(), undefined).host).toEqual({ name: 'Game Master' });
  });

  it('shows the sign-out capture when the DM has not uploaded a screenshot (UX-05)', () => {
    const state = fixtureCampaign();
    state.autoScreenshot = 'a'.repeat(64);
    expect(buildJoinPayload(state, undefined).campaign.screenshot).toBe('a'.repeat(64));
    state.screenshot = 'b'.repeat(64);
    expect(buildJoinPayload(state, undefined).campaign).toEqual({
      title: state.name,
      screenshot: 'b'.repeat(64),
    });
  });
});
