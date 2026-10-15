import { describe, expect, it } from 'vitest';
import { Campaign } from '../schema/index.js';
import { campaignSetBranding } from './campaign.setBranding.js';
import { checkIntent, reduceAction } from './run.js';
import { ACTORS, IDS, makeCampaign, permissionMatrix, testId } from './testing.js';
import type { ActionEnvelope, Actor } from './envelope.js';

const envelope = (type: string, payload: unknown, actor: Actor = ACTORS.host): ActionEnvelope => ({
  id: IDS.action,
  type,
  payload,
  actor,
  campaignId: IDS.campaign,
  sessionId: IDS.session,
  seq: 1,
  ts: 1000,
});
const glyph = { kind: 'glyph', value: '⚔' } as const;
const image = { kind: 'image', hash: 'c'.repeat(64) } as const;

describe('permanent seats keep an icon and a name (UI-SEAT-01)', () => {
  const create = { seatId: testId(21), label: 'Mira', icon: glyph };

  it('seat.create stores the icon and the name, and only the host may create', () => {
    expect(permissionMatrix(makeCampaign(), 'seat.create', create)).toMatchObject({
      host: true,
      owner: false,
      spectator: false,
    });
    const state = reduceAction(makeCampaign(), envelope('seat.create', create)).state;
    expect(state.seats[create.seatId]).toMatchObject({ label: 'Mira', icon: glyph });
    expect(state.seats[create.seatId]?.temporary).toBeUndefined();
    expect(Campaign.safeParse(state).success).toBe(true);
  });

  it('rejects icons that are not a short glyph or a sha256 image hash', () => {
    for (const icon of [
      { kind: 'glyph', value: '' },
      { kind: 'glyph', value: 'too long!!' },
      { kind: 'image', hash: 'nope' },
      { kind: 'image', hash: 'C'.repeat(64) },
      { kind: 'url', value: 'https://example.com/a.png' },
      { ...glyph, junk: true },
    ])
      expect(checkIntent(makeCampaign(), ACTORS.host, 'seat.create', { ...create, icon }).ok).toBe(
        false,
      );
  });

  it('seat.update sets and clears the icon', () => {
    const set = reduceAction(
      makeCampaign(),
      envelope('seat.update', { seatId: IDS.owner, icon: image }),
    ).state;
    expect(set.seats[IDS.owner]?.icon).toEqual(image);
    const cleared = reduceAction(set, envelope('seat.update', { seatId: IDS.owner, icon: null }));
    expect(cleared.state.seats[IDS.owner]?.icon).toBeUndefined();
    expect(
      checkIntent(set, ACTORS.owner, 'seat.update', { seatId: IDS.owner, icon: glyph }).ok,
    ).toBe(false);
  });
});

describe('campaign.setBranding (UI-JOIN-01)', () => {
  it('is host only, strict and needs a field', () => {
    const payload = { icon: glyph, screenshot: 'd'.repeat(64) };
    expect(permissionMatrix(makeCampaign(), 'campaign.setBranding', payload)).toEqual({
      host: true,
      owner: false,
      otherSeat: false,
      coDm: false,
      spectator: false,
      mod: false,
    });
    for (const bad of [{}, { screenshot: 'short' }, { ...payload, junk: 1 }, { name: 'x' }])
      expect(campaignSetBranding.schema.safeParse(bad).success).toBe(false);
  });

  it('sets and clears the icon and screenshot deterministically', () => {
    const payload = { icon: image, screenshot: 'd'.repeat(64) };
    const e = envelope('campaign.setBranding', payload);
    const result = reduceAction(makeCampaign(), e);
    expect(result).toEqual(reduceAction(makeCampaign(), e));
    expect(result.state).toMatchObject(payload);
    const partial = reduceAction(result.state, envelope('campaign.setBranding', { icon: null }));
    expect(partial.state.icon).toBeUndefined();
    expect(partial.state.screenshot).toBe(payload.screenshot);
    expect(Campaign.safeParse(partial.state).success).toBe(true);
  });
});

describe('releasing archived and offline seats (F36, SES-05)', () => {
  const bound = () => {
    const state = makeCampaign();
    const seat = state.seats[IDS.owner];
    if (seat) seat.identityId = IDS.identity;
    return state;
  };

  it('lets the host release a bound seat whether or not its holder is online', () => {
    // The host cannot tell the pipeline whether the holder is connected: release never depends on it.
    const result = reduceAction(bound(), envelope('seat.release', { seatId: IDS.owner }));
    expect(result.state.seats[IDS.owner]?.identityId).toBeNull();
  });

  it('lets the host release an archived seat, keeping it archived and out of the join list', () => {
    const archived = reduceAction(bound(), envelope('seat.archive', { seatId: IDS.owner })).state;
    expect(checkIntent(archived, ACTORS.host, 'seat.release', { seatId: IDS.owner }).ok).toBe(true);
    const released = reduceAction(archived, envelope('seat.release', { seatId: IDS.owner })).state;
    expect(released.seats[IDS.owner]).toMatchObject({ archived: true, identityId: null });
    // Nobody can claim it afterwards.
    expect(
      checkIntent(released, { kind: 'seat', identityId: IDS.otherIdentity }, 'session.join', {
        seatId: IDS.owner,
        identityId: IDS.otherIdentity,
      }).ok,
    ).toBe(false);
  });

  it('does not let a player release somebody else, or the host release a free seat', () => {
    expect(checkIntent(bound(), ACTORS.otherSeat, 'seat.release', { seatId: IDS.owner }).ok).toBe(
      false,
    );
    expect(checkIntent(makeCampaign(), ACTORS.host, 'seat.release', { seatId: IDS.owner }).ok).toBe(
      false,
    );
  });
});
