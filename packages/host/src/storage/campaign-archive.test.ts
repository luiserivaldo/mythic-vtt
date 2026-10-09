import { afterEach, describe, expect, it } from 'vitest';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { storeMigrate } from '@mythic/shared';
import { ArchiveError } from './campaign-archive.js';
import { LocalAssetStore } from './local-asset-store.js';
import { LocalCampaignStore } from './local-campaign-store.js';

const fixture = fileURLToPath(new URL('../../../../fixtures/saves/v1', import.meta.url));
const campaignId = '01J8Z0000000000000000CAMP1';
const sceneId = '01J8Z0000000000000000SCN01';
const roots: string[] = [];
const open: { close: () => unknown }[] = [];
const tmp = (): string => {
  const path = mkdtempSync(join(tmpdir(), 'mythic-archive-'));
  roots.push(path);
  return path;
};
afterEach(async () => {
  for (const item of open.splice(0)) await item.close();
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
const stores = (root: string): { campaigns: LocalCampaignStore; assets: LocalAssetStore } => {
  const assets = new LocalAssetStore(root);
  const campaigns = new LocalCampaignStore(root, storeMigrate, assets);
  open.push(
    {
      close: () => {
        assets.close();
      },
    },
    campaigns,
  );
  return { campaigns, assets };
};
const bytes = Buffer.from('not really a png, but real bytes');
const hash = createHash('sha256').update(bytes).digest('hex');
const toBuffer = async (stream: Readable): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
};

/** Fixture campaign + a scene that references a stored asset + a snapshot. */
async function seed(root: string): Promise<ReturnType<typeof stores>> {
  await cp(join(fixture, 'campaigns'), join(root, 'campaigns'), { recursive: true });
  const s = stores(root);
  await s.assets.put(hash, Readable.from([bytes]), {
    mime: 'image/png',
    size: bytes.length,
    ext: 'png',
  });
  const loaded = await s.campaigns.load(campaignId);
  const scene = loaded.scenes[0];
  if (!scene) throw new Error('fixture scene missing');
  await s.campaigns.saveScene(campaignId, {
    ...scene,
    environment: { ...scene.environment, skybox: { source: 'local', hash, kind: 'image' } },
  });
  await s.campaigns.writeSnapshot(campaignId, '01J8Z0000000000000000SESS1', 'start', {
    seq: 0,
    state: { ...loaded.campaign, scenes: {} },
  });
  return s;
}
const exported = async (s: ReturnType<typeof stores>): Promise<Buffer> =>
  toBuffer(await s.campaigns.export(campaignId));
const rejects = async (
  s: ReturnType<typeof stores>,
  zip: Uint8Array,
  code: string,
  limits?: Parameters<LocalCampaignStore['import']>[1],
): Promise<void> => {
  const promise = s.campaigns.import(Readable.from([Buffer.from(zip)]), limits);
  await expect(promise).rejects.toBeInstanceOf(ArchiveError);
  await expect(promise).rejects.toMatchObject({ code });
  expect(await s.campaigns.list()).toEqual([]);
};

describe('campaign export/import (HIST-03)', () => {
  it('round-trips a campaign with its assets into a fresh store', async () => {
    const source = await seed(tmp());
    const zip = await exported(source);
    const files = unzipSync(zip);
    expect(Object.keys(files).sort()).toEqual([
      'assets/' + hash + '.png',
      'campaign.json',
      'manifest.json',
      `scenes/${sceneId}.json`,
      'sessions/01J8Z0000000000000000SESS1/log.jsonl',
      'sessions/01J8Z0000000000000000SESS1/snapshots/start.json',
    ]);

    const targetRoot = tmp();
    const target = stores(targetRoot);
    const result = await target.campaigns.import(Readable.from([zip]));
    expect(result).toEqual({ campaignId, name: 'The Sunken Chapel', scenes: 1, assets: 1 });
    expect(await target.campaigns.load(campaignId)).toEqual(
      await source.campaigns.load(campaignId),
    );
    expect((await target.campaigns.list()).map((c) => c.id)).toEqual([campaignId]);
    expect(await target.assets.has(hash)).toBe(true);
    expect(await toBuffer(await target.assets.get(hash))).toEqual(bytes);
    const log = (root: string): Promise<string> =>
      readFile(
        join(root, 'campaigns', campaignId, 'sessions', '01J8Z0000000000000000SESS1', 'log.jsonl'),
        'utf8',
      );
    expect(await log(targetRoot)).toEqual(await log(join(zipRoot(source))));
    // re-export of the import equals the original export content
    expect(Object.keys(unzipSync(await exported(target))).sort()).toEqual(
      Object.keys(files).sort(),
    );
  });

  it('retains assets referenced only by a campaign prefab after export and import', async () => {
    const source = await seed(tmp());
    const loaded = await source.campaigns.load(campaignId);
    const scene = loaded.scenes[0];
    if (!scene) throw new Error('scene missing');
    await source.campaigns.saveScene(campaignId, {
      ...scene,
      environment: { background: '#ffffff' },
      entities: {},
    });
    const prefabId = '01J8Z0000000000000000PREF1';
    const prefab = {
      id: prefabId,
      name: 'Asset only in prefab',
      entity: {
        name: 'Textured pillar',
        layer: 'props' as const,
        transform: {
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          scale: { x: 2, y: 3, z: 2 },
        },
        shape: {
          kind: 'cylinder' as const,
          color: '#ffffff',
          walkable: true,
          texture: { source: 'local' as const, hash, kind: 'image' as const },
        },
      },
    };
    await source.campaigns.saveCampaign(campaignId, {
      ...loaded.campaign,
      prefabs: { [prefabId]: prefab },
    });
    const archive = await exported(source);
    expect(unzipSync(archive)['assets/' + hash + '.png']).toEqual(new Uint8Array(bytes));
    const target = stores(tmp());
    await target.campaigns.import(Readable.from([archive]));
    expect((await target.campaigns.load(campaignId)).campaign.prefabs?.[prefabId]).toEqual(prefab);
    expect(await toBuffer(await target.assets.get(hash))).toEqual(bytes);
  });

  it('never leaks secrets, the index or identity links', async () => {
    const root = tmp();
    const source = await seed(root);
    await writeFile(join(root, 'host-secret'), 'topsecret');
    const { campaign } = await source.campaigns.load(campaignId);
    const seat = campaign.seats['01J8Z0000000000000000SEAT2'];
    if (!seat) throw new Error('fixture seat missing');
    await source.campaigns.saveCampaign(campaignId, {
      ...campaign,
      seats: {
        ...campaign.seats,
        [seat.id]: { ...seat, identityId: '01J8Z0000000000000000XYZ99' },
      },
    });
    const files = unzipSync(await exported(source));
    const all = Object.values(files)
      .map((f) => Buffer.from(f).toString('latin1'))
      .join('');
    expect(all).not.toContain('topsecret');
    expect(all).not.toContain('SQLite format');
    expect(all).not.toContain('XYZ99');
    expect(Object.keys(files).some((n) => n.includes('sqlite'))).toBe(false);
  });

  it('rejects an id that already exists instead of overwriting', async () => {
    const source = await seed(tmp());
    const zip = await exported(source);
    await expect(source.campaigns.import(Readable.from([zip]))).rejects.toMatchObject({
      code: 'conflict',
    });
    expect((await source.campaigns.load(campaignId)).campaign.name).toBe('The Sunken Chapel');
  });

  it('rejects an asset whose bytes do not match its hash', async () => {
    const zip = await exported(await seed(tmp()));
    const files = unzipSync(zip);
    files[`assets/${hash}.png`] = strToU8('tampered');
    await rejects(stores(tmp()), zipSync(files), 'hash-mismatch');
  });

  it('rejects an asset whose size differs from the manifest', async () => {
    const files = unzipSync(await exported(await seed(tmp())));
    files[`assets/${hash}.png`] = Buffer.concat([bytes, Buffer.from('x')]);
    await rejects(stores(tmp()), zipSync(files), 'hash-mismatch');
  });

  it.each([
    ['zip-slip', '../evil.json'],
    ['nested zip-slip', 'scenes/../../evil.json'],
    ['absolute path', '/etc/passwd'],
    ['drive path', 'C:/evil.json'],
    ['backslash path', 'scenes\\..\\evil.json'],
    ['unknown entry', 'notes.txt'],
  ])('rejects %s entries', async (_label, name) => {
    const files = unzipSync(await exported(await seed(tmp())));
    await rejects(stores(tmp()), zipSync({ ...files, [name]: strToU8('{}') }), 'invalid-archive');
  });

  it('rejects symlink entries', async () => {
    const files = unzipSync(await exported(await seed(tmp()))) as Zippable;
    const withLink: Zippable = {
      ...files,
      'scenes/link.json': [strToU8('/etc/passwd'), { os: 3, attrs: (0o120777 << 16) >>> 0 }],
    };
    await rejects(stores(tmp()), zipSync(withLink), 'invalid-archive');
  });

  it('rejects zip bombs by entry count, uncompressed size and archive size', async () => {
    const zip = await exported(await seed(tmp()));
    await rejects(stores(tmp()), zip, 'too-large', { maxEntries: 2 });
    await rejects(stores(tmp()), zip, 'too-large', { maxUncompressedBytes: 100 });
    await rejects(stores(tmp()), zip, 'too-large', { maxArchiveBytes: 100 });
    const files = unzipSync(zip) as Zippable;
    const bomb = zipSync({ ...files, [`scenes/${sceneId}.json`]: Buffer.alloc(5_000_000, 0x20) });
    await rejects(stores(tmp()), bomb, 'too-large', { maxJsonBytes: 1_000_000 });
  });

  it('rejects malformed archives and invalid JSON', async () => {
    await rejects(
      stores(tmp()),
      Buffer.from('definitely not a zip file at all'),
      'invalid-archive',
    );
    const files = unzipSync(await exported(await seed(tmp()))) as Zippable;
    await rejects(
      stores(tmp()),
      zipSync({ ...files, 'campaign.json': strToU8('{"schemaVersion":1}') }),
      'invalid-archive',
    );
    await rejects(
      stores(tmp()),
      zipSync({ ...files, [`scenes/${sceneId}.json`]: strToU8('{broken') }),
      'invalid-archive',
    );
    const noManifest = { ...files };
    delete noManifest['manifest.json'];
    await rejects(stores(tmp()), zipSync(noManifest), 'invalid-archive');
  });

  it('leaves no staging directories behind', async () => {
    const root = tmp();
    const s = stores(root);
    await rejects(s, Buffer.from('nope nope nope nope nope nope'), 'invalid-archive');
    expect((await readdir(root)).filter((n) => n.startsWith('.import-'))).toEqual([]);
    await mkdir(join(root, 'x'));
  });
});

function zipRoot(s: { campaigns: LocalCampaignStore }): string {
  return s.campaigns.root;
}
