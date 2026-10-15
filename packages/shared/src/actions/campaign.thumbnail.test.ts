import { describe, expect, it } from 'vitest';
import { Campaign, campaignThumbnail } from '../schema/index.js';
import { campaignSetBranding } from './campaign.setBranding.js';
import { reduceAction } from './run.js';
import { ACTORS, IDS, makeCampaign, permissionMatrix } from './testing.js';
import type { ActionEnvelope } from './envelope.js';

const envelope = (payload: unknown): ActionEnvelope => ({
  id: IDS.action,
  type: 'campaign.setBranding',
  payload,
  actor: ACTORS.host,
  campaignId: IDS.campaign,
  sessionId: IDS.session,
  seq: 1,
  ts: 1000,
});
const upload = 'a'.repeat(64);
const capture = 'b'.repeat(64);

describe('campaign thumbnail (UX-05 / UI-HOST-02)', () => {
  it('stores the sign-out capture through the host-only branding action', () => {
    expect(
      permissionMatrix(makeCampaign(), 'campaign.setBranding', { autoScreenshot: capture }),
    ).toEqual({
      host: true,
      owner: false,
      otherSeat: false,
      coDm: false,
      spectator: false,
      mod: false,
    });
    const state = reduceAction(makeCampaign(), envelope({ autoScreenshot: capture })).state;
    expect(state.autoScreenshot).toBe(capture);
    expect(state.screenshot).toBeUndefined();
    expect(Campaign.safeParse(state).success).toBe(true);
    const cleared = reduceAction(state, envelope({ autoScreenshot: null })).state;
    expect(cleared.autoScreenshot).toBeUndefined();
  });

  it('accepts only a sha256 image hash for the capture', () => {
    for (const bad of ['short', 'B'.repeat(64), { hash: capture }, 1])
      expect(campaignSetBranding.schema.safeParse({ autoScreenshot: bad }).success).toBe(false);
  });

  it('prefers the DM upload over the capture, and a new capture never replaces the upload', () => {
    expect(campaignThumbnail({})).toBeUndefined();
    expect(campaignThumbnail({ autoScreenshot: capture })).toBe(capture);
    const uploaded = reduceAction(makeCampaign(), envelope({ screenshot: upload })).state;
    const captured = reduceAction(uploaded, envelope({ autoScreenshot: capture })).state;
    expect(captured.screenshot).toBe(upload);
    expect(campaignThumbnail(captured)).toBe(upload);
    const removed = reduceAction(captured, envelope({ screenshot: null })).state;
    expect(campaignThumbnail(removed)).toBe(capture);
  });

  it('is additive: a v10 campaign without either field still parses', () => {
    const legacy: Record<string, unknown> = { ...makeCampaign() };
    delete legacy['screenshot'];
    delete legacy['autoScreenshot'];
    expect(Campaign.safeParse(legacy).success).toBe(true);
  });
});
