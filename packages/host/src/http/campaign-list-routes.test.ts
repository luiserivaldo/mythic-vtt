import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import { CampaignList } from '@mythic/protocol';
import { StorageDataError, type CampaignMeta, type LocalCampaignStore } from '../storage/index.js';
import { registerCampaignRoutes } from './campaign-routes.js';
import type { HttpAuthenticator, Principal } from './http-auth.js';

// UX-05 / UI-HOST-02: the DM's campaign list and its thumbnails, host only.

const A = '01J00000000000000000000A01';
const B = '01J00000000000000000000B01';
const stored = 'c'.repeat(64);
const live = 'd'.repeat(64);
const foreign = 'e'.repeat(64);
const rows: CampaignMeta[] = [
  { id: B, name: 'Beta', schemaVersion: 10, updatedAt: 1, lastPlayedAt: 9, thumbnail: stored },
  { id: A, name: 'Alpha', schemaVersion: 10, updatedAt: 2, lastPlayedAt: 5 },
];
const host: Principal = { identityId: 'host', isHost: true, role: 'host' };
const codm: Principal = { identityId: 'codm', isHost: false, role: 'codm', seatId: 'x' };

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

function build(principal: Principal | null, links: Record<string, string[]> = {}) {
  app = Fastify({ logger: false });
  const auth: HttpAuthenticator = {
    authenticate: () =>
      Promise.resolve(principal ? { ok: true, principal } : { ok: false, status: 401 }),
  };
  const store = {
    list: () => Promise.resolve(rows),
    export: () => Promise.reject(new Error('unused')),
    import: () => Promise.reject(new Error('unused')),
  } as unknown as Pick<LocalCampaignStore, 'list' | 'export' | 'import'>;
  registerCampaignRoutes(app, {
    store,
    auth,
    // Alpha is open and its DM just set a thumbnail that is not saved to the index yet.
    current: () => ({ id: A, screenshot: live }),
    thumbnailAsset: (campaignId, hash) =>
      links[campaignId]?.includes(hash)
        ? Promise.resolve(Readable.from([Buffer.from(`${campaignId}:${hash}`)]))
        : Promise.reject(new StorageDataError('Asset not found', 'not-found')),
  });
  return app;
}

describe('GET /api/campaigns', () => {
  it('lists every campaign, last played first, with the live thumbnail of the open one', async () => {
    const response = await build(host).inject({ method: 'GET', url: '/api/campaigns' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(CampaignList.parse(response.json())).toEqual({
      current: A,
      campaigns: [
        { id: B, name: 'Beta', lastPlayedAt: 9, thumbnail: stored },
        { id: A, name: 'Alpha', lastPlayedAt: 5, thumbnail: live },
      ],
    });
  });

  it('refuses anyone but the host, co-DMs included', async () => {
    expect((await build(null).inject({ method: 'GET', url: '/api/campaigns' })).statusCode).toBe(
      401,
    );
    await app?.close();
    const denied = await build(codm).inject({ method: 'GET', url: '/api/campaigns' });
    expect(denied.statusCode).toBe(403);
    expect(denied.body).not.toContain('Beta');
  });
});

describe('GET /api/campaigns/:id/thumbnail', () => {
  it("serves another campaign's thumbnail only when it is linked to that campaign", async () => {
    const server = build(host, { [B]: [stored], [A]: [live] });
    const beta = await server.inject({ method: 'GET', url: `/api/campaigns/${B}/thumbnail` });
    expect(beta.statusCode).toBe(200);
    expect(beta.headers['content-type']).toBe('image/webp');
    expect(beta.body).toBe(`${B}:${stored}`);
    const alpha = await server.inject({ method: 'GET', url: `/api/campaigns/${A}/thumbnail` });
    expect(alpha.body).toBe(`${A}:${live}`);
  });

  it('is 404 for no thumbnail or an unlinked hash, and host only', async () => {
    const server = build(host, { [B]: [foreign] });
    for (const id of [A, B, '01J00000000000000000000Z99'])
      expect(
        (await server.inject({ method: 'GET', url: `/api/campaigns/${id}/thumbnail` })).statusCode,
      ).toBe(404);
    await app?.close();
    expect(
      (
        await build(codm, { [B]: [stored] }).inject({
          method: 'GET',
          url: `/api/campaigns/${B}/thumbnail`,
        })
      ).statusCode,
    ).toBe(403);
  });
});
