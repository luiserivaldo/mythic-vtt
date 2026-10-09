import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { desc } from 'drizzle-orm';
import { mkdir, open, readFile, readdir, stat } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { Id, Scene } from '@mythic/shared';
import type { Readable } from 'node:stream';
import {
  exportCampaign,
  importCampaign,
  type ArchiveHost,
  type AssetSource,
  type ImportLimits,
  type ImportResult,
} from './campaign-archive.js';
import { atomicWrite } from './io.js';
import { campaigns } from './index-schema.js';
import {
  CampaignFile,
  CURRENT_SCHEMA_VERSION,
  LogEntry,
  Snapshot,
  StorageDataError,
  type CampaignMeta,
  type CampaignStore,
  type LoadedCampaign,
  type Migration,
} from './types.js';

const Disk = z.object({ schemaVersion: z.number().int().nonnegative() }).loose();
const identity: Migration = (_kind, _version, payload) => payload;
const safeId = (value: string): string => Id.parse(value);
const SessionMeta = z.object({
  schemaVersion: z.number().int().positive(),
  sessionId: Id,
  startedAt: z.number().int().nonnegative(),
});
export type SessionMeta = z.infer<typeof SessionMeta>;

export class LocalCampaignStore implements CampaignStore, ArchiveHost {
  private readonly db: Database.Database;
  private readonly index;
  private readonly pending = new Map<string, Promise<void>>();
  private readonly dirty = new Map<string, Promise<void>>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    readonly root: string,
    private readonly migrate: Migration = identity,
    /** Needed to export/import the assets a campaign references (HIST-03). */
    readonly assets?: AssetSource,
  ) {
    mkdirSync(root, { recursive: true });
    this.db = new Database(join(root, 'index.sqlite'));
    this.index = drizzle(this.db);
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS campaigns (id TEXT PRIMARY KEY, name TEXT NOT NULL, schema_version INTEGER NOT NULL, updated_at INTEGER NOT NULL)',
    );
  }
  list(): Promise<CampaignMeta[]> {
    return Promise.resolve(
      this.index.select().from(campaigns).orderBy(desc(campaigns.updatedAt)).all(),
    );
  }
  /** @internal used by campaign-archive */
  folder(id: string): string {
    return join(this.root, 'campaigns', safeId(id));
  }
  /** @internal used by campaign-archive */
  async exists(id: string): Promise<boolean> {
    if (
      this.index
        .select()
        .from(campaigns)
        .all()
        .some((row) => row.id === id)
    )
      return true;
    return (await stat(this.folder(id)).catch(() => undefined)) !== undefined;
  }
  /** @internal used by campaign-archive */
  readFile<T>(
    path: string,
    kind: 'campaign' | 'scene' | 'snapshot' | 'session',
    schema: z.ZodType<T>,
  ): Promise<T> {
    return this.read(path, kind, schema);
  }
  private async read<T>(
    path: string,
    kind: 'campaign' | 'scene' | 'snapshot' | 'session',
    schema: z.ZodType<T>,
  ): Promise<T> {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(path, 'utf8')) as unknown;
    } catch (error) {
      throw new StorageDataError(`Cannot read ${path}: ${String(error)}`, 'corrupt');
    }
    const disk = Disk.safeParse(raw);
    if (!disk.success) throw new StorageDataError(`Invalid envelope: ${path}`, 'corrupt');
    if (
      disk.data.schemaVersion !== CURRENT_SCHEMA_VERSION &&
      (disk.data.schemaVersion > CURRENT_SCHEMA_VERSION || this.migrate === identity)
    )
      throw new StorageDataError(
        `Newer schemaVersion: ${String(disk.data.schemaVersion)}`,
        'unsupported-version',
      );
    try {
      const payload =
        kind === 'campaign' || kind === 'session'
          ? disk.data
          : Object.fromEntries(
              Object.entries(disk.data).filter(([key]) => key !== 'schemaVersion'),
            );
      return schema.parse(this.migrate(kind, disk.data.schemaVersion, payload));
    } catch (error) {
      throw new StorageDataError(`Invalid ${kind}: ${String(error)}`, 'corrupt');
    }
  }
  async load(campaignId: Id): Promise<LoadedCampaign> {
    const folder = this.folder(campaignId);
    const campaign = await this.read(join(folder, 'campaign.json'), 'campaign', CampaignFile);
    const scenes: Scene[] = [];
    let names: string[];
    try {
      names = await readdir(join(folder, 'scenes'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') names = [];
      else throw error;
    }
    for (const name of names.filter((n) => n.endsWith('.json')).sort())
      scenes.push(await this.read(join(folder, 'scenes', name), 'scene', Scene));
    return { campaign, scenes };
  }
  async saveCampaign(campaignId: Id, campaign: CampaignFile): Promise<void> {
    safeId(campaignId);
    const parsed = CampaignFile.parse(campaign);
    if (parsed.id !== campaignId) throw new StorageDataError('Campaign id mismatch', 'corrupt');
    if (parsed.schemaVersion !== CURRENT_SCHEMA_VERSION)
      throw new StorageDataError('Unsupported campaign schemaVersion', 'unsupported-version');
    await atomicWrite(
      join(this.folder(campaignId), 'campaign.json'),
      JSON.stringify({ ...parsed, schemaVersion: CURRENT_SCHEMA_VERSION }),
    );
    this.index
      .insert(campaigns)
      .values({
        id: parsed.id,
        name: parsed.name,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        updatedAt: Date.now(),
      })
      .onConflictDoUpdate({
        target: campaigns.id,
        set: { name: parsed.name, schemaVersion: CURRENT_SCHEMA_VERSION, updatedAt: Date.now() },
      })
      .run();
  }
  async saveScene(campaignId: Id, scene: Scene): Promise<void> {
    const parsed = Scene.parse(scene);
    await atomicWrite(
      join(this.folder(campaignId), 'scenes', `${safeId(parsed.id)}.json`),
      JSON.stringify({ ...parsed, schemaVersion: CURRENT_SCHEMA_VERSION }),
    );
  }
  async appendLog(campaignId: Id, sessionId: Id, entries: LogEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const path = join(this.folder(campaignId), 'sessions', safeId(sessionId), 'log.jsonl');
    await mkdir(join(this.folder(campaignId), 'sessions', sessionId), { recursive: true });
    const lines = entries.map((entry) => JSON.stringify(LogEntry.parse(entry)) + '\n').join('');
    const previous = this.pending.get(path) ?? Promise.resolve();
    const write = previous.then(async () => {
      const file = await open(path, 'a');
      try {
        await file.writeFile(lines);
      } finally {
        await file.close();
      }
    });
    this.pending.set(path, write);
    try {
      await write;
    } finally {
      if (this.pending.get(path) === write) this.pending.delete(path);
    }
    this.dirty.set(path, write);
    this.timer ??= setTimeout(() => {
      void this.flushLogs();
    }, 500);
  }
  async flushLogs(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const dirty = [...this.dirty];
    this.dirty.clear();
    await Promise.all(
      dirty.map(async ([path, write]) => {
        await write;
        const file = await open(path, 'r');
        try {
          await file.sync();
        } finally {
          await file.close();
        }
      }),
    );
  }
  async writeSnapshot(
    campaignId: Id,
    sessionId: Id,
    label: string,
    snapshot: Snapshot,
  ): Promise<void> {
    if (!/^[a-zA-Z0-9_-]+$/.test(label))
      throw new StorageDataError('Invalid snapshot label', 'corrupt');
    await atomicWrite(
      join(this.folder(campaignId), 'sessions', safeId(sessionId), 'snapshots', `${label}.json`),
      JSON.stringify({ schemaVersion: CURRENT_SCHEMA_VERSION, ...Snapshot.parse(snapshot) }),
    );
  }
  async startSession(campaignId: Id, meta: SessionMeta, snapshot: Snapshot): Promise<void> {
    const dir = join(this.folder(campaignId), 'sessions', safeId(meta.sessionId));
    await atomicWrite(
      join(dir, 'start.snapshot.json'),
      JSON.stringify({ schemaVersion: CURRENT_SCHEMA_VERSION, ...Snapshot.parse(snapshot) }),
    );
    await atomicWrite(join(dir, 'meta.json'), JSON.stringify(SessionMeta.parse(meta)));
  }
  async readSessions(campaignId: Id): Promise<SessionMeta[]> {
    const dir = join(this.folder(campaignId), 'sessions');
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const sessions: SessionMeta[] = [];
    for (const name of names) {
      if (!Id.safeParse(name).success) continue;
      const path = join(dir, name, 'meta.json');
      let raw: string;
      try {
        raw = await readFile(path, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      const disk = SessionMeta.parse(JSON.parse(raw) as unknown);
      const meta = SessionMeta.parse(this.migrate('session', disk.schemaVersion, disk));
      if (meta.sessionId !== name || meta.schemaVersion !== CURRENT_SCHEMA_VERSION)
        throw new StorageDataError(`Invalid session metadata: ${path}`, 'corrupt');
      sessions.push(meta);
    }
    return sessions.sort(
      (a, b) => a.startedAt - b.startedAt || a.sessionId.localeCompare(b.sessionId),
    );
  }
  async readSessionSnapshot(
    campaignId: Id,
    sessionId: Id,
    label: 'start' | 'autosave' | 'end',
  ): Promise<Snapshot | undefined> {
    const path =
      label === 'start'
        ? join(this.folder(campaignId), 'sessions', safeId(sessionId), 'start.snapshot.json')
        : join(
            this.folder(campaignId),
            'sessions',
            safeId(sessionId),
            'snapshots',
            `${label}.json`,
          );
    try {
      return await this.read(path, 'snapshot', Snapshot);
    } catch (error) {
      if (error instanceof StorageDataError && error.message.includes('ENOENT')) return undefined;
      throw error;
    }
  }
  async readSessionLog(campaignId: Id, sessionId: Id): Promise<LogEntry[]> {
    const path = join(this.folder(campaignId), 'sessions', safeId(sessionId), 'log.jsonl');
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    // An interrupted append leaves an unterminated final line; it was never a complete entry.
    const lines = raw.endsWith('\n') ? raw.slice(0, -1).split('\n') : raw.split('\n').slice(0, -1);
    return lines.filter(Boolean).map((line, index) => {
      try {
        return LogEntry.parse(JSON.parse(line) as unknown);
      } catch (error) {
        throw new StorageDataError(
          `Invalid log entry ${String(index + 1)} in ${path}: ${String(error)}`,
          'corrupt',
        );
      }
    });
  }
  /** Zip stream of the campaign and referenced assets. Local only: never needs cloud/entitlements. */
  export(campaignId: Id): Promise<Readable> {
    safeId(campaignId);
    return Promise.resolve(exportCampaign(this, campaignId, () => this.load(campaignId)));
  }
  /**
   * Imports an export zip. An id that already exists is never overwritten: rejects with
   * `ArchiveError` code `conflict` (the caller may delete the old campaign first).
   */
  import(source: Readable, limits?: Partial<ImportLimits>): Promise<ImportResult> {
    return importCampaign(this, source, limits);
  }
  async close(): Promise<void> {
    await this.flushLogs();
    this.db.close();
  }
}
