import { describe, expect, it } from 'vitest';
import type { CampaignList } from '@mythic/protocol';
import {
  campaignRows,
  dmLinkToken,
  fetchCampaignList,
  fetchCampaignThumbnail,
  hostScreenView,
  pickCampaign,
  sortCampaigns,
  type HostFetch,
} from './host-screen.js';

// UI-HOST-01 / UI-HOST-02: the DM's host screen, its campaign list and how it is reached.

const A = '01J00000000000000000000A01';
const B = '01J00000000000000000000B01';
const C = '01J00000000000000000000C01';
const D = '01J00000000000000000000D01';
const hash = 'a'.repeat(64);
const credential = { identityId: '01J00000000000000000000H01', identitySecret: 's3cret' };

const list: CampaignList = {
  current: B,
  campaigns: [
    { id: C, name: 'Gamma' },
    { id: A, name: 'Alpha', lastPlayedAt: 100 },
    { id: D, name: '' },
    { id: B, name: 'Beta', lastPlayedAt: 300, thumbnail: hash },
  ],
};

describe('sortCampaigns', () => {
  it('puts the most recently played first and never-played last, keeping their order', () => {
    expect(sortCampaigns(list.campaigns).map((c) => c.id)).toEqual([B, A, C, D]);
  });

  it('is stable for equal times and does not mutate its input', () => {
    const tied = [
      { id: A, name: 'a', lastPlayedAt: 5 },
      { id: B, name: 'b', lastPlayedAt: 5 },
    ];
    expect(sortCampaigns(tied).map((c) => c.id)).toEqual([A, B]);
    expect(sortCampaigns([])).toEqual([]);
    const copy = structuredClone(list.campaigns);
    sortCampaigns(list.campaigns);
    expect(list.campaigns).toEqual(copy);
  });
});

describe('campaignRows', () => {
  it('labels last played, thumbnails and the open campaign', () => {
    expect(campaignRows(list, (ms) => `t${String(ms)}`)).toEqual([
      { id: B, name: 'Beta', played: 'Last played t300', hasThumbnail: true, current: true },
      { id: A, name: 'Alpha', played: 'Last played t100', hasThumbnail: false, current: false },
      { id: C, name: 'Gamma', played: 'Never played', hasThumbnail: false, current: false },
      {
        id: D,
        name: 'Untitled campaign',
        played: 'Never played',
        hasThumbnail: false,
        current: false,
      },
    ]);
  });
});

describe('dmLinkToken', () => {
  it('reads the token from a pasted DM link or takes a bare token', () => {
    expect(dmLinkToken(' http://192.168.1.4:8787/#host=AbC_d-123 ')).toBe('AbC_d-123');
    expect(dmLinkToken('http://h/#foo=1&host=tok')).toBe('tok');
    expect(dmLinkToken('abcdefghijklmnopqrstuvwx')).toBe('abcdefghijklmnopqrstuvwx');
  });

  it('refuses anything that is not a DM link', () => {
    for (const text of ['', 'http://h/', 'http://h/#watch=x', 'http://h/#host=', 'short', 'a b'])
      expect(dmLinkToken(text)).toBeUndefined();
    expect(dmLinkToken('http://h/#host=<script>')).toBeUndefined();
  });
});

describe('pickCampaign', () => {
  it('goes on to the table only for the campaign the host has open', () => {
    expect(pickCampaign(list, B)).toEqual({ step: 'table', notice: null });
    const other = pickCampaign(list, A);
    expect(other.step).toBe('campaigns');
    expect(other.notice).toContain('restart the host');
    expect(other.notice).toContain('Alpha');
  });
});

describe('hostScreenView', () => {
  const base = { fatalError: null, ready: true, list: { kind: 'ok', list } as const };
  it('follows the steps once the host has listed the campaigns', () => {
    expect(hostScreenView({ ...base, step: 'campaigns' })).toBe('campaigns');
    expect(hostScreenView({ ...base, step: 'table' })).toBe('table');
    expect(hostScreenView({ ...base, step: 'done' })).toBe('done');
  });

  it('waits for the connection and the list', () => {
    expect(hostScreenView({ ...base, ready: false, step: 'campaigns' })).toBe('connecting');
    expect(hostScreenView({ ...base, list: { kind: 'loading' }, step: 'table' })).toBe(
      'connecting',
    );
    expect(hostScreenView({ ...base, list: { kind: 'error' }, step: 'campaigns' })).toBe('error');
  });

  it('shows nothing of the table to an identity the host refuses', () => {
    expect(hostScreenView({ ...base, list: { kind: 'denied' }, step: 'table' })).toBe('refused');
    expect(
      hostScreenView({ ...base, fatalError: 'unauthorized: host token rejected', step: 'table' }),
    ).toBe('refused');
  });
});

const respond =
  (status: number, body: unknown, seen: { url: string; init: RequestInit }[] = []): HostFetch =>
  (url, init) => {
    seen.push({ url, init });
    return Promise.resolve(
      new Response(body instanceof Blob ? body : JSON.stringify(body), { status }),
    );
  };

describe('fetchCampaignList', () => {
  it('sends the identity in the header only and validates the reply', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    expect(await fetchCampaignList(respond(200, list, seen), credential)).toEqual({
      kind: 'ok',
      list,
    });
    expect(seen[0]?.url).toBe('/api/campaigns');
    expect(seen[0]?.init.headers).toEqual({
      Authorization: `Mythic ${credential.identityId}.${credential.identitySecret}`,
    });
  });

  it('maps refusals, failures and malformed replies', async () => {
    expect(await fetchCampaignList(respond(403, {}), credential)).toEqual({ kind: 'denied' });
    expect(await fetchCampaignList(respond(401, {}), credential)).toEqual({ kind: 'denied' });
    expect(await fetchCampaignList(respond(404, {}), credential)).toEqual({ kind: 'error' });
    expect(await fetchCampaignList(respond(200, { current: 'x' }), credential)).toEqual({
      kind: 'error',
    });
    expect(await fetchCampaignList(() => Promise.reject(new Error('offline')), credential)).toEqual(
      { kind: 'error' },
    );
  });
});

describe('fetchCampaignThumbnail', () => {
  it('returns an image blob, or null for a refusal or a non-image', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const image = new Blob(['x'], { type: 'image/webp' });
    expect((await fetchCampaignThumbnail(respond(200, image, seen), credential, A))?.type).toBe(
      'image/webp',
    );
    expect(seen[0]?.url).toBe(`/api/campaigns/${A}/thumbnail`);
    expect(await fetchCampaignThumbnail(respond(403, {}), credential, A)).toBeNull();
    const other = new Blob(['x'], { type: 'application/octet-stream' });
    expect(await fetchCampaignThumbnail(respond(200, other), credential, A)).toBeNull();
  });
});
