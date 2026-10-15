import Database from 'better-sqlite3';
import { storeMigrate, type Campaign } from '@mythic/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatCampaignList } from '../campaign-picker.js';
import { newCampaign } from '../engine/campaign.js';
import { byLastPlayed, LocalCampaignStore } from './local-campaign-store.js';
import { CampaignFile, CURRENT_SCHEMA_VERSION, type CampaignMeta } from './types.js';

// UX-05 / UI-HOST-02: last played (session start) and the thumbnail live in the host-local
// campaigns index, rebuilt from the campaign folders; the save format is unchanged.

const A = '01J00000000000000000000A01';
const B = '01J00000000000000000000B01';
const C = '01J00000000000000000000C01';
const SESSION = (n: number) => `01J0000000000000000000S${String(n).padStart(3, '0')}`;
const upload = 'a'.repeat(64);
const capture = 'b'.repeat(64);

const roots: string[] = [];
const root = (): string => {
  const path = mkdtempSync(join(tmpdir(), 'mythic-played-'));
  roots.push(path);
  return path;
};
const stores: LocalCampaignStore[] = [];
const open = (dir: string) => {
  const store = new LocalCampaignStore(dir, storeMigrate);
  stores.push(store);
  return store;
};
afterEach(async () => {
  await Promise.all(stores.splice(0).map((s) => s.close().catch(() => undefined)));
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function save(store: LocalCampaignStore, id: string, extra: Partial<Campaign> = {}) {
  const campaign = { ...newCampaign(id, `Campaign ${id.slice(-3)}`), ...extra };
  for (const scene of Object.values(campaign.scenes)) await store.saveScene(id, scene);
  await store.saveCampaign(id, CampaignFile.parse(campaign));
  return campaign;
}

async function play(store: LocalCampaignStore, id: string, n: number, startedAt: number) {
  const state = (await store.load(id)).campaign as Campaign;
  await store.startSession(
    id,
    { schemaVersion: CURRENT_SCHEMA_VERSION, sessionId: SESSION(n), startedAt },
    { seq: 0, state: { ...state, scenes: {} } },
  );
}

const ids = (list: CampaignMeta[]) => list.map((c) => c.id);
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('last played (UX-05)', () => {
  it('is set when a session starts, and the list is newest-played first', async () => {
    const store = open(root());
    await save(store, A);
    await tick();
    await save(store, B);
    await tick();
    await save(store, C);
    // C was saved last but never played; B was played after A.
    await play(store, A, 1, 1_000);
    await play(store, B, 2, 2_000);
    const list = await store.list();
    expect(ids(list)).toEqual([B, A, C]);
    expect(list.find((c) => c.id === A)?.lastPlayedAt).toBe(1_000);
    expect(list.find((c) => c.id === C)).not.toHaveProperty('lastPlayedAt');
    // Saving does not count as playing: an autosave of A keeps B first.
    await save(store, A);
    expect(ids(await store.list())).toEqual([B, A, C]);
    await play(store, A, 3, 3_000);
    expect(ids(await store.list())).toEqual([A, B, C]);
  });

  it('orders never-played campaigns by their last save', () => {
    const meta = (id: string, updatedAt: number, lastPlayedAt?: number): CampaignMeta => ({
      id,
      name: id,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      updatedAt,
      ...(lastPlayedAt !== undefined ? { lastPlayedAt } : {}),
    });
    const sorted = [meta(A, 50), meta(B, 10, 0), meta(C, 90)].sort(byLastPlayed);
    expect(ids(sorted)).toEqual([B, C, A]);
  });

  it('is rebuilt from session folders when the index is lost', async () => {
    const dir = root();
    const store = open(dir);
    await save(store, A);
    await save(store, B);
    await play(store, A, 1, 5_000);
    await play(store, A, 2, 7_000);
    await store.close();
    await rm(join(dir, 'index.sqlite'));
    const rebuilt = open(dir);
    expect((await rebuilt.reindex()).added.sort()).toEqual([A, B]);
    const list = await rebuilt.list();
    expect(ids(list)).toEqual([A, B]);
    expect(list[0]?.lastPlayedAt).toBe(7_000);
  });
});

describe('campaign thumbnail in the index (UX-05)', () => {
  it('records the DM upload over the capture, and clears with them', async () => {
    const store = open(root());
    await save(store, A, { autoScreenshot: capture });
    expect((await store.list())[0]?.thumbnail).toBe(capture);
    await save(store, A, { autoScreenshot: capture, screenshot: upload });
    expect((await store.list())[0]?.thumbnail).toBe(upload);
    await save(store, A);
    expect((await store.list())[0]).not.toHaveProperty('thumbnail');
  });

  it('fills both columns for an index written before UX-05, without rewriting files', async () => {
    const dir = root();
    const folder = join(dir, 'campaigns', A);
    await mkdir(join(folder, 'sessions', SESSION(1)), { recursive: true });
    await writeFile(
      join(folder, 'campaign.json'),
      JSON.stringify(CampaignFile.parse({ ...newCampaign(A, 'Old'), screenshot: upload })),
    );
    await writeFile(
      join(folder, 'sessions', SESSION(1), 'meta.json'),
      JSON.stringify({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        sessionId: SESSION(1),
        startedAt: 4_000,
      }),
    );
    // The MV-168 index: no last_played_at or thumbnail columns.
    const legacy = new Database(join(dir, 'index.sqlite'));
    legacy.exec(
      'CREATE TABLE campaigns (id TEXT PRIMARY KEY, name TEXT NOT NULL, schema_version INTEGER NOT NULL, updated_at INTEGER NOT NULL)',
    );
    legacy
      .prepare('INSERT INTO campaigns VALUES (?, ?, ?, ?)')
      .run(A, 'Old', CURRENT_SCHEMA_VERSION, 1);
    legacy.close();

    const store = open(dir);
    expect(await store.list()).toEqual([
      { id: A, name: 'Old', schemaVersion: CURRENT_SCHEMA_VERSION, updatedAt: 1 },
    ]);
    expect((await store.reindex()).added).toEqual([]);
    expect(await store.list()).toEqual([
      {
        id: A,
        name: 'Old',
        schemaVersion: CURRENT_SCHEMA_VERSION,
        updatedAt: 1,
        lastPlayedAt: 4_000,
        thumbnail: upload,
      },
    ]);
  });
});

describe('start-up picker lines (UI-HOST-02)', () => {
  it('shows last played and whether there is a thumbnail', () => {
    const lines = formatCampaignList([
      {
        id: A,
        name: 'Alpha',
        schemaVersion: CURRENT_SCHEMA_VERSION,
        updatedAt: 0,
        lastPlayedAt: Date.UTC(2026, 9, 12, 4, 40),
        thumbnail: upload,
      },
      { id: B, name: 'Beta', schemaVersion: CURRENT_SCHEMA_VERSION, updatedAt: 0 },
    ]);
    expect(lines).toEqual([
      `  1) Alpha  (${A}, last played 2026-10-12 04:40 UTC, thumbnail)`,
      `  2) Beta  (${B}, never played)`,
    ]);
  });
});
