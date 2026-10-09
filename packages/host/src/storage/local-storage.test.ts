import { CURRENT_SCHEMA_VERSION } from '@mythic/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { atomicWrite } from './io.js';
import { LocalCampaignStore } from './local-campaign-store.js';
import { LocalAssetStore } from './local-asset-store.js';
import {
  assetStoreConformance,
  campaignStoreConformance,
  sampleCampaign,
  sampleLog,
  sampleScene,
} from './conformance.js';
import { StorageDataError } from './types.js';

const roots: string[] = [];
const root = (): string => {
  const path = mkdtempSync(join(tmpdir(), 'mythic-storage-'));
  roots.push(path);
  return path;
};
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
campaignStoreConformance(() => {
  const store = new LocalCampaignStore(root());
  return { store, close: () => store.close() };
});
assetStoreConformance(() => {
  const store = new LocalAssetStore(root());
  return {
    store,
    close: () => {
      store.close();
      return Promise.resolve();
    },
  };
});

describe('local storage durability', () => {
  it('replaces JSON atomically and leaves no partial target', async () => {
    const base = root();
    const store = new LocalCampaignStore(base);
    try {
      await store.saveCampaign(sampleCampaign.id, sampleCampaign);
      await store.saveCampaign(sampleCampaign.id, { ...sampleCampaign, name: 'Changed' });
      const folder = join(base, 'campaigns', sampleCampaign.id);
      expect((await readdir(folder)).filter((name) => name.startsWith('.tmp-'))).toEqual([]);
      expect(JSON.parse(await readFile(join(folder, 'campaign.json'), 'utf8'))).toMatchObject({
        name: 'Changed',
      });
    } finally {
      await store.close();
    }
  });
  it('preserves the old file when a streamed atomic write fails', async () => {
    const base = root();
    const path = join(base, 'stable.json');
    await atomicWrite(path, '{"ok":true}');
    const broken = Readable.from(
      (function* () {
        yield 'partial';
        throw new Error('interrupted');
      })(),
    );
    await expect(atomicWrite(path, broken)).rejects.toThrow('interrupted');
    expect(await readFile(path, 'utf8')).toBe('{"ok":true}');
    expect((await readdir(base)).filter((name) => name.startsWith('.tmp-'))).toEqual([]);
  });
  it('preserves log order and flushes within 500ms', async () => {
    vi.useFakeTimers();
    const base = root();
    const store = new LocalCampaignStore(base);
    const flush = vi.spyOn(store, 'flushLogs');
    try {
      await store.appendLog(sampleCampaign.id, sampleLog.envelope.sessionId, [sampleLog]);
      await store.appendLog(sampleCampaign.id, sampleLog.envelope.sessionId, [
        { ...sampleLog, envelope: { ...sampleLog.envelope, seq: 2 } },
      ]);
      const path = join(
        base,
        'campaigns',
        sampleCampaign.id,
        'sessions',
        sampleLog.envelope.sessionId,
        'log.jsonl',
      );
      expect(
        (await readFile(path, 'utf8'))
          .trim()
          .split('\n')
          .map((line) => (JSON.parse(line) as { envelope: { seq: number } }).envelope.seq),
      ).toEqual([1, 2]);
      await vi.advanceTimersByTimeAsync(499);
      expect(flush).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(flush).toHaveBeenCalledTimes(1);
    } finally {
      await store.close();
    }
  });
  it('rejects corrupt and newer campaign files', async () => {
    const base = root();
    const store = new LocalCampaignStore(base);
    try {
      await store.saveCampaign(sampleCampaign.id, sampleCampaign);
      const path = join(base, 'campaigns', sampleCampaign.id, 'campaign.json');
      await writeFile(path, '{broken');
      await expect(store.load(sampleCampaign.id)).rejects.toMatchObject({
        code: 'corrupt',
      } satisfies Partial<StorageDataError>);
      await writeFile(
        path,
        JSON.stringify({ ...sampleCampaign, schemaVersion: CURRENT_SCHEMA_VERSION + 1 }),
      );
      await expect(store.load(sampleCampaign.id)).rejects.toMatchObject({
        code: 'unsupported-version',
      } satisfies Partial<StorageDataError>);
      await writeFile(path, JSON.stringify({ ...sampleCampaign, schemaVersion: 0 }));
      await expect(store.load(sampleCampaign.id)).rejects.toMatchObject({
        code: 'unsupported-version',
      });
    } finally {
      await store.close();
    }
  });
  it('rejects an asset with mismatched content before publication', async () => {
    const base = root();
    const store = new LocalAssetStore(base);
    try {
      const hash = createHash('sha256').update('expected').digest('hex');
      await expect(
        store.put(hash, Readable.from(['wrong']), { mime: 'text/plain', size: 5, ext: 'txt' }),
      ).rejects.toMatchObject({ code: 'corrupt' });
      expect(await store.has(hash)).toBe(false);
      expect(await readdir(join(base, 'assets'))).toEqual([]);
    } finally {
      store.close();
    }
  });
  it('validates scene files when loading', async () => {
    const base = root();
    const store = new LocalCampaignStore(base);
    try {
      await store.saveCampaign(sampleCampaign.id, sampleCampaign);
      await store.saveScene(sampleCampaign.id, sampleScene);
      const path = join(base, 'campaigns', sampleCampaign.id, 'scenes', `${sampleScene.id}.json`);
      await writeFile(path, JSON.stringify({ schemaVersion: 1, id: sampleScene.id }));
      await expect(store.load(sampleCampaign.id)).rejects.toMatchObject({ code: 'corrupt' });
    } finally {
      await store.close();
    }
  });
});
