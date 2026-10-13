import { storeMigrate } from '@mythic/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { loadConfig, type HostConfig } from './config.js';
import { CampaignSelectionError, newCampaign } from './engine/index.js';
import { createSeatInvites } from './gateway/seat-invites.js';
import { createSpectatorLinks } from './gateway/spectator-links.js';
import { startHost, type RunningHost } from './server.js';
import { CampaignFile, LocalAssetStore, LocalCampaignStore } from './storage/index.js';

const A = '01J00000000000000000000A01';
const B = '01J00000000000000000000B01';
const art = Buffer.from('campaign B only: the lich lair map');
const artHash = createHash('sha256').update(art).digest('hex');

let dir: string;
let host: RunningHost | undefined;
const config = (extra: Record<string, string> = {}): HostConfig =>
  loadConfig({ MYTHIC_PORT: '0', MYTHIC_DATA_DIR: dir, ...extra });

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mythic-multi-host-'));
  const assets = new LocalAssetStore(dir);
  const store = new LocalCampaignStore(dir, storeMigrate, assets);
  // A saved last, so it is the newest and what an unconfigured host opens.
  for (const [id, name] of [
    [B, 'Beta'],
    [A, 'Alpha'],
  ] as const) {
    const campaign = newCampaign(id, name);
    for (const scene of Object.values(campaign.scenes)) await store.saveScene(id, scene);
    await store.saveCampaign(id, CampaignFile.parse(campaign));
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await assets.put(artHash, Readable.from([art]), {
    mime: 'image/webp',
    size: art.length,
    ext: 'webp',
  });
  assets.link(B, artHash);
  // Modern data dir: the legacy backfill (which would adopt this unplaced asset) already ran.
  assets.setMeta('campaign-assets-backfill-v1', '1');
  await store.close();
  assets.close();
});
afterEach(async () => {
  await host?.close();
  host = undefined;
  await rm(dir, { recursive: true, force: true });
});

describe('host with several campaigns (HOST-03)', () => {
  it('opens the newest by default and the chosen one by id or name', async () => {
    host = await startHost(config());
    expect(host.engine.state().id).toBe(A);
    await host.close();
    host = undefined;
    host = await startHost(config({ MYTHIC_CAMPAIGN_ID: B }));
    expect(host.engine.state().id).toBe(B);
    await host.close();
    host = undefined;
    host = await startHost(config({ MYTHIC_CAMPAIGN: 'alpha' }));
    expect(host.engine.state().id).toBe(A);
  });

  it('uses the picker only when no campaign was chosen', async () => {
    const asked: string[][] = [];
    const chooseCampaign = (list: readonly { id: string }[]) => {
      asked.push(list.map((c) => c.id));
      return Promise.resolve(B);
    };
    host = await startHost(config(), { chooseCampaign });
    expect(host.engine.state().id).toBe(B);
    expect(asked).toEqual([[A, B]]);
    await host.close();
    host = undefined;
    host = await startHost(config({ MYTHIC_CAMPAIGN: 'Alpha' }), { chooseCampaign });
    expect(host.engine.state().id).toBe(A);
    expect(asked).toHaveLength(1);
  });

  it('creates a campaign on request and leaves the others alone', async () => {
    host = await startHost(config({ MYTHIC_NEW_CAMPAIGN: 'Gamma' }));
    expect(host.engine.state().name).toBe('Gamma');
    const created = host.engine.state().id;
    expect([A, B]).not.toContain(created);
    await host.close();
    host = undefined;
    const store = new LocalCampaignStore(dir, storeMigrate);
    try {
      expect((await store.list()).map((c) => c.name).sort()).toEqual(['Alpha', 'Beta', 'Gamma']);
    } finally {
      await store.close();
    }
  });

  it('refuses an unknown campaign with the available ones, without starting', async () => {
    await expect(startHost(config({ MYTHIC_CAMPAIGN: 'Delta' }))).rejects.toThrow(
      CampaignSelectionError,
    );
    await expect(startHost(config({ MYTHIC_CAMPAIGN: 'Delta' }))).rejects.toThrow(/Alpha/);
  });

  it("does not serve one campaign's assets while another is open (leak)", async () => {
    host = await startHost(config({ MYTHIC_CAMPAIGN_ID: A }));
    const foreign = await host.gateway.app.inject({ method: 'GET', url: `/assets/${artHash}` });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.body).not.toContain('lich lair');
    await host.close();
    host = undefined;
    host = await startHost(config({ MYTHIC_CAMPAIGN_ID: B }));
    const own = await host.gateway.app.inject({ method: 'GET', url: `/assets/${artHash}` });
    expect(own.statusCode).toBe(200);
    expect(own.body).toBe(art.toString());
  });

  it("keeps a campaign's spectator link out of the other campaigns (leak)", () => {
    const index = join(dir, 'index.sqlite');
    const forA = createSpectatorLinks(index, A);
    const forB = createSpectatorLinks(index, B);
    try {
      const token = forA.rotate();
      expect(forA.valid(token)).toBe(true);
      expect(forB.valid(token)).toBe(false);
    } finally {
      forA.close();
      forB.close();
    }
  });

  it("keeps a campaign's seat invites out of the other campaigns, even for the same seat id (leak)", () => {
    const index = join(dir, 'index.sqlite');
    const forA = createSeatInvites(index, A);
    const forB = createSeatInvites(index, B);
    try {
      const seat = '01J00000000000000000000S01';
      const token = forA.rotate(seat);
      expect(forA.valid(seat, token)).toBe(true);
      expect(forB.valid(seat, token)).toBe(false);
      expect(forB.seatIds()).toEqual([]);
      const own = forB.rotate(seat);
      expect(forA.valid(seat, own)).toBe(false);
      expect(forA.valid(seat, token)).toBe(true);
    } finally {
      forA.close();
      forB.close();
    }
  });
});
