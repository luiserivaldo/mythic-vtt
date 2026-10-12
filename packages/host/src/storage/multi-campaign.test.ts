import { storeMigrate, type Scene } from '@mythic/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { cp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { newCampaign } from '../engine/campaign.js';
import { backfillAssetLinks } from './asset-links.js';
import { LocalAssetStore, scopedAssetStore } from './local-asset-store.js';
import { LocalCampaignStore } from './local-campaign-store.js';
import { sampleLog } from './conformance.js';
import { CampaignFile } from './types.js';

const A = '01J00000000000000000000A01';
const B = '01J00000000000000000000B01';
const roots: string[] = [];
const root = (): string => {
  const path = mkdtempSync(join(tmpdir(), 'mythic-multi-'));
  roots.push(path);
  return path;
};
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const bytes = (text: string) => ({
  hash: createHash('sha256').update(text).digest('hex'),
  size: Buffer.byteLength(text),
  data: () => Readable.from([Buffer.from(text)]),
});
const meta = (size: number) => ({ mime: 'image/webp', size, ext: 'webp' });

async function seed(
  store: LocalCampaignStore,
  id: string,
  name: string,
  seatName: string,
  skyboxHash?: string,
) {
  const created = newCampaign(id, name);
  const seatId = `SEAT${id.slice(-3)}`.padEnd(26, '0');
  const scene: Scene = {
    ...blank(created.scenes[id]),
    name: `${name} map`,
    environment: {
      background: '#000',
      ...(skyboxHash ? { skybox: { source: 'local', hash: skyboxHash, kind: 'image' } } : {}),
    },
  };
  await store.saveScene(id, scene);
  await store.saveCampaign(
    id,
    CampaignFile.parse({
      ...created,
      seats: {
        [seatId]: {
          id: seatId,
          label: seatName,
          binding: 'persistent',
          identityId: null,
          role: 'player',
          permissions: { view: true, move: true, edit: false, delete: false },
        },
      },
    }),
  );
}
const blank = (scene: Scene | undefined): Scene => {
  if (!scene) throw new Error('scene missing');
  return scene;
};

describe('several campaigns in one data dir (HOST-03)', () => {
  it('keeps seats, scenes and session logs apart', async () => {
    const store = new LocalCampaignStore(root(), storeMigrate);
    try {
      await seed(store, A, 'Alpha', 'Alice');
      await seed(store, B, 'Beta', 'Bob');
      await store.appendLog(A, sampleLog.envelope.sessionId, [
        { ...sampleLog, envelope: { ...sampleLog.envelope, campaignId: A } },
      ]);
      const a = await store.load(A);
      const b = await store.load(B);
      expect(Object.values(a.campaign.seats).map((seat) => seat.label)).toEqual(['Alice']);
      expect(Object.values(b.campaign.seats).map((seat) => seat.label)).toEqual(['Bob']);
      expect(a.scenes.map((scene) => scene.name)).toEqual(['Alpha map']);
      expect(b.scenes.map((scene) => scene.name)).toEqual(['Beta map']);
      expect(await store.readSessionLog(A, sampleLog.envelope.sessionId)).toHaveLength(1);
      expect(await store.readSessionLog(B, sampleLog.envelope.sessionId)).toEqual([]);
      expect(await store.readSessions(B)).toEqual([]);
      expect((await store.list()).map((c) => c.name).sort()).toEqual(['Alpha', 'Beta']);
    } finally {
      await store.close();
    }
  });

  it('rebuilds the campaign index from the folders and reports what it could not read', async () => {
    const base = root();
    const first = new LocalCampaignStore(base, storeMigrate);
    await seed(first, A, 'Alpha', 'Alice');
    await seed(first, B, 'Beta', 'Bob');
    await first.close();
    for (const name of await readdir(base))
      if (name.startsWith('index.sqlite')) await rm(join(base, name));
    await writeFile(join(base, 'campaigns', 'not-a-campaign-id'), 'stray file');
    await rm(join(base, 'campaigns', B, 'campaign.json'));
    const store = new LocalCampaignStore(base, storeMigrate);
    try {
      expect(await store.list()).toEqual([]);
      const result = await store.reindex();
      expect(result.added).toEqual([A]);
      expect(result.skipped.map((s) => s.id)).toEqual([B]);
      expect((await store.list()).map((c) => c.id)).toEqual([A]);
      expect((await store.reindex()).added).toEqual([]);
    } finally {
      await store.close();
    }
  });

  it.each(['v1', 'v2', 'v3', 'v4'])(
    'opens a %s single-campaign data dir with no index and loses nothing',
    async (version) => {
      const base = root();
      const fixtures = fileURLToPath(new URL('../../../../fixtures/saves', import.meta.url));
      await cp(join(fixtures, version, 'campaigns'), join(base, 'campaigns'), { recursive: true });
      const id = '01J8Z0000000000000000CAMP1';
      const file = join(base, 'campaigns', id, 'campaign.json');
      const before = await readFile(file, 'utf8');
      const store = new LocalCampaignStore(base, storeMigrate);
      try {
        expect((await store.reindex()).added).toEqual([id]);
        expect((await store.list()).map((c) => c.name)).toEqual(['The Sunken Chapel']);
        const loaded = await store.load(id);
        expect(Object.keys(loaded.campaign.seats)).toHaveLength(2);
        expect(loaded.scenes.map((scene) => scene.name)).toEqual(['Flooded Nave']);
        // A second campaign alongside it does not disturb the first one's files.
        await seed(store, B, 'Beta', 'Bob');
        expect(await readFile(file, 'utf8')).toBe(before);
        expect((await store.list()).map((c) => c.id).sort()).toEqual([id, B].sort());
      } finally {
        await store.close();
      }
    },
  );
});

describe('campaign-scoped assets (HOST-03)', () => {
  it('answers a foreign hash like an unknown one, and links duplicate uploads', async () => {
    const base = root();
    const pool = new LocalAssetStore(base);
    try {
      const secret = bytes('map of the lich lair');
      const forA = scopedAssetStore(pool, A);
      const forB = scopedAssetStore(pool, B);
      await forA.put(secret.hash, secret.data(), meta(secret.size));
      expect(await forA.has(secret.hash)).toBe(true);
      expect(await forB.has(secret.hash)).toBe(false);
      expect(() => forB.get(secret.hash)).toThrow(expect.objectContaining({ code: 'not-found' }));
      await expect(forA.get(secret.hash)).resolves.toBeDefined();
      // The same bytes uploaded by B reuse the file but are now linked to B as well.
      await forB.put(secret.hash, secret.data(), meta(secret.size));
      expect(await forB.has(secret.hash)).toBe(true);
      expect(await readdir(join(base, 'assets'))).toHaveLength(1);
    } finally {
      pool.close();
    }
  });

  it('backfills legacy assets by reference once, keeping unreferenced ones reachable', async () => {
    const base = root();
    const pool = new LocalAssetStore(base);
    const store = new LocalCampaignStore(base, storeMigrate, pool);
    try {
      const mapA = bytes('alpha map');
      const mapB = bytes('beta map');
      const shared = bytes('placed in both');
      const orphan = bytes('uploaded, never placed');
      for (const item of [mapA, mapB, shared, orphan])
        await pool.put(item.hash, item.data(), meta(item.size));
      await seed(store, A, 'Alpha', 'Alice', mapA.hash);
      await seed(store, B, 'Beta', 'Bob', mapB.hash);
      // `shared` is referenced from both campaigns' campaign.json via a prefab-like note field.
      for (const id of [A, B]) {
        const path = join(base, 'campaigns', id, 'campaign.json');
        const json = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
        await writeFile(path, JSON.stringify({ ...json, legacyRef: shared.hash }));
      }
      await backfillAssetLinks(pool, store);
      const linked = (id: string, hash: string) => pool.isLinked(id, hash);
      expect([linked(A, mapA.hash), linked(B, mapA.hash)]).toEqual([true, false]);
      expect([linked(A, mapB.hash), linked(B, mapB.hash)]).toEqual([false, true]);
      expect([linked(A, shared.hash), linked(B, shared.hash)]).toEqual([true, true]);
      expect([linked(A, orphan.hash), linked(B, orphan.hash)]).toEqual([true, true]);
      // Runs once: later unlinking is not undone by the next start.
      expect(pool.getMeta('campaign-assets-backfill-v1')).toBe('1');
    } finally {
      await store.close();
      pool.close();
    }
  });

  it('waits for a campaign before claiming orphaned assets', async () => {
    const base = root();
    const pool = new LocalAssetStore(base);
    const store = new LocalCampaignStore(base, storeMigrate, pool);
    try {
      const orphan = bytes('early upload');
      await pool.put(orphan.hash, orphan.data(), meta(orphan.size));
      await backfillAssetLinks(pool, store);
      expect(pool.getMeta('campaign-assets-backfill-v1')).toBeUndefined();
      await seed(store, A, 'Alpha', 'Alice');
      await backfillAssetLinks(pool, store);
      expect(pool.isLinked(A, orphan.hash)).toBe(true);
    } finally {
      await store.close();
      pool.close();
    }
  });

  it('links assets from an imported archive to the imported campaign only', async () => {
    const source = root();
    const poolS = new LocalAssetStore(source);
    const storeS = new LocalCampaignStore(source, storeMigrate, poolS);
    const target = root();
    const poolT = new LocalAssetStore(target);
    const storeT = new LocalCampaignStore(target, storeMigrate, poolT);
    try {
      const art = bytes('exported art');
      await poolS.put(art.hash, art.data(), meta(art.size));
      await seed(storeS, A, 'Alpha', 'Alice', art.hash);
      await seed(storeT, B, 'Beta', 'Bob');
      await storeT.import(await storeS.export(A));
      expect(poolT.isLinked(A, art.hash)).toBe(true);
      expect(poolT.isLinked(B, art.hash)).toBe(false);
    } finally {
      await storeS.close();
      await storeT.close();
      poolS.close();
      poolT.close();
    }
  });
});
