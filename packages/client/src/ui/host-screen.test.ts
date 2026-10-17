import { describe, expect, it } from 'vitest';
import type { CampaignList } from '@mythic/protocol';
import {
  campaignRows,
  dmLinkToken,
  fetchCampaignList,
  fetchCampaignThumbnail,
  foreignDmLinkHost,
  hostScreenView,
  pickCampaign,
  refusedCause,
  refusedDetails,
  refusedLinkMessage,
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
  const real = 'AbC_d-12345678901234567890123456'; // 32 characters, like the host's own tokens

  it('reads the token from a pasted DM link or takes a bare token', () => {
    expect(dmLinkToken(` http://192.168.1.4:8787/#host=${real} `)).toBe(real);
    expect(dmLinkToken(`http://h/#foo=1&host=${real}`)).toBe(real);
    expect(dmLinkToken(`#host=${real}`)).toBe(real);
    expect(dmLinkToken(` ${real} `)).toBe(real);
  });

  it('applies the same 16 to 256 character bound to a bare token and a #host= link', () => {
    for (const length of [16, 32, 256]) {
      const token = 'a'.repeat(length);
      expect(dmLinkToken(token)).toBe(token);
      expect(dmLinkToken(`http://h/#host=${token}`)).toBe(token);
    }
    for (const length of [1, 15, 257]) {
      const token = 'a'.repeat(length);
      expect(dmLinkToken(token)).toBeUndefined();
      expect(dmLinkToken(`http://h/#host=${token}`)).toBeUndefined();
    }
  });

  it('refuses anything that is not a DM link', () => {
    for (const text of ['', 'http://h/', 'http://h/#watch=x', 'http://h/#host=', 'short', 'a b'])
      expect(dmLinkToken(text)).toBeUndefined();
    expect(dmLinkToken('http://h/#host=<script>aaaaaaaaaaaaaaaa')).toBeUndefined();
    expect(dmLinkToken(`${real} ${real}`)).toBeUndefined();
  });
});

describe('foreignDmLinkHost', () => {
  const page = 'http://192.168.1.4:8787';
  const token = 'a'.repeat(32);

  it('says nothing for a link to this page', () => {
    expect(foreignDmLinkHost(`http://192.168.1.4:8787/#host=${token}`, page)).toBeNull();
    expect(foreignDmLinkHost(` HTTP://192.168.1.4:8787#host=${token} `, page)).toBeNull();
    expect(foreignDmLinkHost(`http://192.168.1.4:8787/play?x=1#host=${token}`, page)).toBeNull();
    expect(foreignDmLinkHost(`192.168.1.4:8787/#host=${token}`, page)).toBeNull();
  });

  it('says nothing for a bare token or a bare fragment, which carry no origin', () => {
    expect(foreignDmLinkHost(token, page)).toBeNull();
    expect(foreignDmLinkHost(`#host=${token}`, page)).toBeNull();
  });

  it('says nothing for a relative link, which is for this page', () => {
    expect(foreignDmLinkHost(`/#host=${token}`, page)).toBeNull();
    expect(foreignDmLinkHost(`/play?x=1#host=${token}`, page)).toBeNull();
    expect(foreignDmLinkHost(`./#host=${token}`, page)).toBeNull();
    expect(foreignDmLinkHost(`?x=1#host=${token}`, page)).toBeNull();
    expect(foreignDmLinkHost(`//table.example.com/#host=${token}`, page)).toBe('table.example.com');
  });

  it('names the other host', () => {
    expect(foreignDmLinkHost(`https://table.example.com/#host=${token}`, page)).toBe(
      'table.example.com',
    );
    expect(foreignDmLinkHost(`http://localhost:8787/#host=${token}`, page)).toBe('localhost:8787');
    expect(foreignDmLinkHost(`table.example.com:9000/#host=${token}`, page)).toBe(
      'table.example.com:9000',
    );
  });

  it('names the whole origin when only the port or the scheme differs', () => {
    expect(foreignDmLinkHost(`http://192.168.1.4:9000/#host=${token}`, page)).toBe(
      'http://192.168.1.4:9000',
    );
    expect(foreignDmLinkHost(`https://192.168.1.4:8787/#host=${token}`, page)).toBe(
      'https://192.168.1.4:8787',
    );
    expect(
      foreignDmLinkHost(`https://table.example.com/#host=${token}`, 'http://table.example.com'),
    ).toBe('https://table.example.com');
  });

  it('treats an address it cannot read as another host', () => {
    expect(foreignDmLinkHost(`http://[bad/#host=${token}`, page)).toBe('http://[bad/');
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
  const base = {
    fatalError: null,
    ready: true,
    list: { kind: 'ok', list } as const,
    campaign: true,
  };
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
    expect(hostScreenView({ ...base, list: { kind: 'denied', status: 403 }, step: 'table' })).toBe(
      'refused',
    );
    expect(
      hostScreenView({ ...base, fatalError: 'unauthorized: host token rejected', step: 'table' }),
    ).toBe('refused');
  });

  it('says the campaign is loading rather than showing a blank table step (MV-285)', () => {
    expect(hostScreenView({ ...base, campaign: false, step: 'table' })).toBe('table-loading');
    expect(hostScreenView({ ...base, campaign: false, step: 'campaigns' })).toBe('campaigns');
    expect(
      hostScreenView({ ...base, campaign: false, fatalError: 'connection failed', step: 'table' }),
    ).toBe('refused');
  });
});

describe('refused DM link (MV-285)', () => {
  const at = Date.UTC(2026, 9, 17, 12, 0, 0);

  it('splits the fatal error the host sent into its code and message', () => {
    expect(refusedCause('unauthorized: host token rejected', { kind: 'loading' })).toEqual({
      kind: 'error',
      code: 'unauthorized',
      message: 'host token rejected',
    });
    expect(refusedCause('connection failed', { kind: 'loading' })).toEqual({
      kind: 'error',
      code: '',
      message: 'connection failed',
    });
    expect(refusedCause(null, { kind: 'denied', status: 403 })).toEqual({
      kind: 'denied',
      status: 403,
    });
  });

  it('gives one plain line for every refusal the host does not tell apart (D24)', () => {
    const generic = "This DM link can't be used. Please make a new link.";
    for (const fatal of [
      'unauthorized: host token rejected',
      'unauthorized: identity secret mismatch',
      'server-error: boom',
      'connection failed',
    ])
      expect(refusedLinkMessage(refusedCause(fatal, { kind: 'loading' }))).toBe(generic);
    expect(refusedLinkMessage({ kind: 'denied', status: 401 })).toBe(generic);
  });

  it('tells a protocol mismatch apart: reloading fetches the matching page', () => {
    expect(
      refusedLinkMessage(refusedCause('protocol-mismatch: v2 required', { kind: 'loading' })),
    ).toBe('This page is out of date for this host. Please reload.');
  });

  it('details carry code, message, fatal flag and time, never the token', () => {
    const details = refusedDetails(
      refusedCause('unauthorized: host token rejected', { kind: 'loading' }),
      at,
    );
    expect(details).toBe(
      'Code: unauthorized\nMessage: host token rejected\nFatal: true\nTime: 2026-10-17T12:00:00.000Z',
    );
    expect(refusedDetails({ kind: 'denied', status: 403 }, at)).toBe(
      'GET /api/campaigns: HTTP 403\nTime: 2026-10-17T12:00:00.000Z',
    );
    expect(refusedDetails({ kind: 'error', code: '', message: 'connection failed' }, at)).toContain(
      'Code: none',
    );
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
    expect(await fetchCampaignList(respond(403, {}), credential)).toEqual({
      kind: 'denied',
      status: 403,
    });
    expect(await fetchCampaignList(respond(401, {}), credential)).toEqual({
      kind: 'denied',
      status: 401,
    });
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
