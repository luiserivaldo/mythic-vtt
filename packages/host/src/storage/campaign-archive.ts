// HIST-03 / TECHNICAL §8.4: portable zip of one campaign plus the assets it references.
// Layout inside the zip (all paths are relative, forward-slash, whitelisted on import):
//   manifest.json  campaign.json  scenes/<id>.json
//   sessions/<id>/log.jsonl  sessions/<id>/snapshots/<label>.json
//   assets/<sha256>.<ext>
// Never exported: index.sqlite, host secret, identities, seat/spectator tokens (§8.2 keeps
// those outside the campaign folder), and `identityId` links, which are meaningless on another host.
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { PassThrough, type Readable } from 'node:stream';
import { Unzip, UnzipInflate, UnzipPassThrough, Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { z } from 'zod';
import { Id, Scene } from '@mythic/shared';
import {
  AssetMeta,
  CampaignFile,
  CURRENT_SCHEMA_VERSION,
  LogEntry,
  Snapshot,
  type AssetStore,
} from './types.js';

export type ArchiveErrorCode =
  'invalid-archive' | 'too-large' | 'hash-mismatch' | 'conflict' | 'no-asset-store';
/** Import/export failure. `conflict`: a campaign with that id already exists (never overwritten). */
export class ArchiveError extends Error {
  constructor(
    message: string,
    public readonly code: ArchiveErrorCode,
  ) {
    super(message);
  }
}

/** An asset store that can also report stored metadata (needed to name/typed entries on export). */
export type AssetSource = AssetStore & { meta(hash: string): Promise<AssetMeta | undefined> };

export interface ImportLimits {
  maxArchiveBytes: number;
  maxUncompressedBytes: number;
  maxEntries: number;
  maxJsonBytes: number;
}
export const DEFAULT_IMPORT_LIMITS: ImportLimits = {
  maxArchiveBytes: 2 * 1024 ** 3,
  maxUncompressedBytes: 4 * 1024 ** 3,
  maxEntries: 20_000,
  maxJsonBytes: 32 * 1024 ** 2,
};
export interface ImportResult {
  campaignId: string;
  name: string;
  scenes: number;
  assets: number;
}

const Manifest = z.object({
  format: z.literal('mythic-campaign-export'),
  formatVersion: z.literal(1),
  campaignId: Id,
  schemaVersion: z.number().int().positive(),
  assets: z.array(
    z.object({
      hash: z.string().regex(/^[0-9a-f]{64}$/),
      size: z.number().int().nonnegative(),
      mime: z.string().min(1),
      ext: z.string().regex(/^[a-z0-9]+$/),
    }),
  ),
  /** Referenced by a scene but absent from the source asset store at export time. */
  missingAssets: z.array(z.string().regex(/^[0-9a-f]{64}$/)),
});

/** The pieces of LocalCampaignStore the archive code needs (kept narrow on purpose). */
export interface ArchiveHost {
  readonly root: string;
  readonly assets?: AssetSource | undefined;
  folder(id: string): string;
  readFile<T>(
    path: string,
    kind: 'campaign' | 'scene' | 'snapshot',
    schema: z.ZodType<T>,
  ): Promise<T>;
  exists(id: string): Promise<boolean>;
  flushLogs(): Promise<void>;
  saveScene(campaignId: string, scene: Scene): Promise<void>;
  saveCampaign(campaignId: string, campaign: CampaignFile): Promise<void>;
  appendLog(campaignId: string, sessionId: string, entries: LogEntry[]): Promise<void>;
  writeSnapshot(campaignId: string, sessionId: string, label: string, s: Snapshot): Promise<void>;
}

const LABEL = /^[a-zA-Z0-9_-]+$/;
const FIXED_MTIME = new Date('1980-01-01T00:00:00Z');

function collectAssetHashes(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) for (const item of value) collectAssetHashes(item, into);
  else if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (
      record['source'] === 'local' &&
      typeof record['hash'] === 'string' &&
      /^[0-9a-f]{64}$/.test(record['hash'])
    )
      into.add(record['hash']);
    for (const item of Object.values(record)) collectAssetHashes(item, into);
  }
}
const stripIdentities = <T extends { seats: Record<string, { identityId: string | null }> }>(
  campaign: T,
): T => ({
  ...campaign,
  seats: Object.fromEntries(
    Object.entries(campaign.seats).map(([id, seat]) => [id, { ...seat, identityId: null }]),
  ),
});
const listDir = async (path: string): Promise<string[]> => {
  try {
    return (await readdir(path)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
};

export function exportCampaign(
  host: ArchiveHost,
  campaignId: string,
  load: () => Promise<{ campaign: CampaignFile; scenes: Scene[] }>,
): Readable {
  const out = new PassThrough();
  let blocked = false;
  const zip = new Zip((error, chunk, final) => {
    if (error) {
      out.destroy(error);
      return;
    }
    if (!out.write(chunk)) blocked = true;
    if (final) out.end();
  });
  const settle = async (): Promise<void> => {
    if (blocked) {
      blocked = false;
      await once(out, 'drain');
    }
  };
  const newEntry = (name: string, store: boolean): ZipDeflate | ZipPassThrough => {
    const file = store ? new ZipPassThrough(name) : new ZipDeflate(name, { level: 6 });
    file.mtime = FIXED_MTIME;
    return file;
  };
  const addBytes = async (name: string, data: Uint8Array, store = false): Promise<void> => {
    const file = newEntry(name, store);
    zip.add(file);
    file.push(data, true);
    await settle();
  };
  const addStream = async (name: string, data: Readable, store: boolean): Promise<void> => {
    const file = newEntry(name, store);
    zip.add(file);
    for await (const chunk of data) {
      file.push(new Uint8Array(chunk as Buffer), false);
      await settle();
    }
    file.push(new Uint8Array(0), true);
    await settle();
  };
  const run = async (): Promise<void> => {
    await host.flushLogs();
    const { campaign, scenes } = await load();
    const hashes = new Set<string>();
    collectAssetHashes(campaign, hashes);
    const text = (value: unknown): Uint8Array =>
      new TextEncoder().encode(
        JSON.stringify({ ...(value as object), schemaVersion: CURRENT_SCHEMA_VERSION }),
      );
    const found: z.infer<typeof Manifest>['assets'] = [];
    const missing: string[] = [];
    for (const scene of scenes) collectAssetHashes(scene, hashes);
    for (const hash of [...hashes].sort()) {
      const meta = await host.assets?.meta(hash);
      if (meta) found.push({ hash, ...meta });
      else missing.push(hash);
    }
    await addBytes(
      'manifest.json',
      new TextEncoder().encode(
        JSON.stringify(
          Manifest.parse({
            format: 'mythic-campaign-export',
            formatVersion: 1,
            campaignId,
            schemaVersion: CURRENT_SCHEMA_VERSION,
            assets: found,
            missingAssets: missing,
          }),
        ),
      ),
    );
    await addBytes('campaign.json', text(stripIdentities(campaign)));
    for (const scene of scenes) await addBytes(`scenes/${scene.id}.json`, text(scene));
    const folder = host.folder(campaignId);
    for (const sessionId of (await listDir(join(folder, 'sessions'))).filter(
      (n) => Id.safeParse(n).success,
    )) {
      const base = join(folder, 'sessions', sessionId);
      const log = join(base, 'log.jsonl');
      if ((await stat(log).catch(() => undefined))?.isFile())
        await addStream(`sessions/${sessionId}/log.jsonl`, createReadStream(log), false);
      for (const name of (await listDir(join(base, 'snapshots'))).filter((n) =>
        n.endsWith('.json'),
      )) {
        const label = name.slice(0, -5);
        if (!LABEL.test(label)) continue;
        const snapshot = await host.readFile(join(base, 'snapshots', name), 'snapshot', Snapshot);
        await addBytes(
          `sessions/${sessionId}/snapshots/${name}`,
          text({ ...snapshot, state: stripIdentities(snapshot.state) }),
        );
      }
    }
    for (const { hash, ext } of found) {
      const data = await host.assets?.get(hash);
      if (data) await addStream(`assets/${hash}.${ext}`, data, true);
    }
    zip.end();
  };
  run().catch((error: unknown) => {
    zip.terminate();
    out.destroy(error instanceof Error ? error : new Error(String(error)));
  });
  return out;
}

// ---------------------------------------------------------------- import

interface CentralEntry {
  name: string;
  size: number;
  dir: boolean;
}

const bad = (message: string): ArchiveError => new ArchiveError(message, 'invalid-archive');

/** Rejects zip-slip, absolute/drive paths, backslashes, NULs and `.`/`..`/empty segments. */
function checkName(name: string): void {
  if (name.length === 0 || name.length > 512) throw bad('Invalid entry name length');
  if (name.includes('\0') || name.includes('\\')) throw bad(`Unsafe entry name: ${name}`);
  if (name.startsWith('/') || /^[a-zA-Z]:/.test(name)) throw bad(`Absolute entry path: ${name}`);
  const segments = (name.endsWith('/') ? name.slice(0, -1) : name).split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..'))
    throw bad(`Path traversal in entry: ${name}`);
}

async function readCentralDirectory(path: string, limits: ImportLimits): Promise<CentralEntry[]> {
  const handle = await open(path, 'r');
  try {
    const { size } = await handle.stat();
    if (size < 22) throw bad('Not a zip archive');
    const tailLength = Math.min(size, 22 + 0xffff);
    const tail = Buffer.alloc(tailLength);
    await handle.read(tail, 0, tailLength, size - tailLength);
    let eocd = -1;
    for (let i = tailLength - 22; i >= 0; i -= 1)
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    if (eocd < 0) throw bad('End of central directory not found');
    const count = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff)
      throw bad('ZIP64 archives are not supported');
    if (count > limits.maxEntries) throw new ArchiveError('Too many entries', 'too-large');
    if (cdOffset + cdSize > size || cdSize > 16 * 1024 ** 2) throw bad('Bad central directory');
    const cd = Buffer.alloc(cdSize);
    await handle.read(cd, 0, cdSize, cdOffset);
    const entries: CentralEntry[] = [];
    const seen = new Set<string>();
    let pos = 0;
    let total = 0;
    for (let i = 0; i < count; i += 1) {
      if (pos + 46 > cdSize || cd.readUInt32LE(pos) !== 0x02014b50) throw bad('Bad central entry');
      const madeBy = cd.readUInt16LE(pos + 4);
      const flags = cd.readUInt16LE(pos + 8);
      const method = cd.readUInt16LE(pos + 10);
      const usize = cd.readUInt32LE(pos + 24);
      const nameLen = cd.readUInt16LE(pos + 28);
      const extraLen = cd.readUInt16LE(pos + 30);
      const commentLen = cd.readUInt16LE(pos + 32);
      const external = cd.readUInt32LE(pos + 38);
      if (pos + 46 + nameLen + extraLen + commentLen > cdSize) throw bad('Bad central entry');
      const name = cd.toString('utf8', pos + 46, pos + 46 + nameLen);
      pos += 46 + nameLen + extraLen + commentLen;
      checkName(name);
      if (flags & 1) throw bad('Encrypted entries are not supported');
      if (method !== 0 && method !== 8) throw bad(`Unsupported compression for ${name}`);
      if (madeBy >> 8 === 3) {
        const type = (external >>> 16) & 0o170000;
        if (type === 0o120000) throw bad(`Symlink entry rejected: ${name}`);
        if (type !== 0 && type !== 0o100000 && type !== 0o040000)
          throw bad(`Special file entry rejected: ${name}`);
      }
      if (seen.has(name)) throw bad(`Duplicate entry: ${name}`);
      seen.add(name);
      total += usize;
      if (total > limits.maxUncompressedBytes)
        throw new ArchiveError('Archive exceeds uncompressed size limit', 'too-large');
      entries.push({ name, size: usize, dir: name.endsWith('/') });
    }
    return entries;
  } finally {
    await handle.close();
  }
}

type Kind =
  | { kind: 'manifest' }
  | { kind: 'campaign' }
  | { kind: 'scene'; id: string }
  | { kind: 'log'; session: string }
  | { kind: 'snapshot'; session: string; label: string }
  | { kind: 'asset'; hash: string; ext: string };

function classify(name: string): Kind {
  const p = name.split('/');
  const id = (value: string | undefined): string => {
    if (value === undefined || !Id.safeParse(value).success) throw bad(`Unexpected entry: ${name}`);
    return value;
  };
  if (name === 'manifest.json') return { kind: 'manifest' };
  if (name === 'campaign.json') return { kind: 'campaign' };
  if (p.length === 2 && p[0] === 'scenes' && p[1]?.endsWith('.json'))
    return { kind: 'scene', id: id(p[1].slice(0, -5)) };
  if (p.length === 3 && p[0] === 'sessions' && p[2] === 'log.jsonl')
    return { kind: 'log', session: id(p[1]) };
  if (p.length === 4 && p[0] === 'sessions' && p[2] === 'snapshots' && p[3]?.endsWith('.json')) {
    const label = p[3].slice(0, -5);
    if (!LABEL.test(label)) throw bad(`Unexpected entry: ${name}`);
    return { kind: 'snapshot', session: id(p[1]), label };
  }
  const asset = /^assets\/([0-9a-f]{64})\.([a-z0-9]+)$/.exec(name);
  if (asset?.[1] && asset[2]) return { kind: 'asset', hash: asset[1], ext: asset[2] };
  throw bad(`Unexpected entry: ${name}`);
}

interface Staged {
  kind: Kind;
  path: string;
  size: number;
  sha256: string;
}

export async function importCampaign(
  host: ArchiveHost,
  source: Readable,
  overrides: Partial<ImportLimits> = {},
): Promise<ImportResult> {
  const limits = { ...DEFAULT_IMPORT_LIMITS, ...overrides };
  const staging = join(host.root, `.import-${randomUUID()}`);
  await mkdir(staging, { recursive: true });
  let createdCampaign: string | undefined;
  try {
    // 1. stage the archive on disk (capped) so the central directory can be read first.
    const archivePath = join(staging, 'archive.zip');
    let received = 0;
    const archiveOut = createWriteStream(archivePath);
    for await (const chunk of source) {
      received += (chunk as Buffer).length;
      if (received > limits.maxArchiveBytes) {
        archiveOut.destroy();
        throw new ArchiveError('Archive too large', 'too-large');
      }
      if (!archiveOut.write(chunk)) await once(archiveOut, 'drain');
    }
    archiveOut.end();
    await once(archiveOut, 'finish');

    // 2. validate every entry from the central directory, then inflate with real byte counters.
    const central = await readCentralDirectory(archivePath, limits);
    const byName = new Map(central.map((entry) => [entry.name, entry]));
    for (const entry of central) if (!entry.dir) classify(entry.name);
    const staged = new Map<string, Staged>();
    let total = 0;
    const state: { failure: Error | undefined } = { failure: undefined };
    let pendingDrain: Promise<unknown> | undefined;
    const sinks: Promise<void>[] = [];
    const throwIfFailed = (): void => {
      const failure: Error | undefined = state.failure;
      if (failure) throw failure;
    };
    const unzip = new Unzip();
    unzip.register(UnzipInflate);
    unzip.register(UnzipPassThrough);
    unzip.onfile = (file) => {
      try {
        checkName(file.name);
        const entry = byName.get(file.name);
        if (!entry || staged.has(file.name)) throw bad(`Entry mismatch: ${file.name}`);
        if (entry.dir) {
          file.terminate();
          return;
        }
        const kind = classify(file.name);
        const path = join(staging, `entry-${String(staged.size)}`);
        const sink = createWriteStream(path);
        sinks.push(
          once(sink, 'finish').then(
            () => undefined,
            (e: unknown) => {
              state.failure = e instanceof Error ? e : new Error(String(e));
            },
          ),
        );
        const hash = createHash('sha256');
        let size = 0;
        const record: Staged = { kind, path, size: 0, sha256: '' };
        staged.set(file.name, record);
        file.ondata = (error, chunk, final) => {
          if (state.failure) return;
          if (error) {
            state.failure = error;
            return;
          }
          size += chunk.length;
          total += chunk.length;
          if (
            total > limits.maxUncompressedBytes ||
            (kind.kind !== 'asset' && kind.kind !== 'log' && size > limits.maxJsonBytes) ||
            size > entry.size
          ) {
            state.failure = new ArchiveError('Entry exceeds declared or allowed size', 'too-large');
            sink.destroy();
            file.terminate();
            return;
          }
          hash.update(chunk);
          if (!sink.write(chunk)) pendingDrain = once(sink, 'drain');
          if (final) {
            record.size = size;
            record.sha256 = hash.digest('hex');
            sink.end();
            if (size !== entry.size) state.failure = bad(`Size mismatch for ${file.name}`);
          }
        };
        file.start();
      } catch (error) {
        state.failure = error instanceof Error ? error : new Error(String(error));
      }
    };
    const reader = createReadStream(archivePath, { highWaterMark: 16 * 1024 });
    for await (const chunk of reader) {
      try {
        unzip.push(new Uint8Array(chunk as Buffer), false);
      } catch (error) {
        throw bad(`Malformed archive: ${String(error)}`);
      }
      throwIfFailed();
      if (pendingDrain) {
        await pendingDrain;
        pendingDrain = undefined;
      }
    }
    try {
      unzip.push(new Uint8Array(0), true);
    } catch (error) {
      throw bad(`Malformed archive: ${String(error)}`);
    }
    throwIfFailed();
    for (const entry of central)
      if (!entry.dir && !staged.has(entry.name))
        throw bad(`Entry missing from archive: ${entry.name}`);
    await Promise.all(sinks);
    throwIfFailed();

    // 3. manifest, assets (hash + size) before anything is written.
    const manifestEntry = staged.get('manifest.json');
    if (!manifestEntry) throw bad('manifest.json missing');
    const manifest = Manifest.safeParse(await parseJson(manifestEntry.path));
    if (!manifest.success) throw bad('Invalid manifest.json');
    const expectedAssets = new Map(manifest.data.assets.map((a) => [a.hash, a]));
    if (expectedAssets.size !== manifest.data.assets.length) throw bad('Duplicate manifest asset');
    const seenAssets = new Set<string>();
    for (const item of staged.values()) {
      if (item.kind.kind !== 'asset') continue;
      const wanted = expectedAssets.get(item.kind.hash);
      if (!wanted || wanted.ext !== item.kind.ext) throw bad('Asset not listed in manifest');
      if (item.sha256 !== item.kind.hash || item.size !== wanted.size)
        throw new ArchiveError(`Asset hash or size mismatch: ${item.kind.hash}`, 'hash-mismatch');
      seenAssets.add(item.kind.hash);
    }
    if (seenAssets.size !== expectedAssets.size) throw bad('Manifest asset missing from archive');
    if (expectedAssets.size > 0 && !host.assets)
      throw new ArchiveError('No asset store configured for import', 'no-asset-store');

    // 4. validate every JSON file (schema + migrations) before any write.
    const campaignEntry = staged.get('campaign.json');
    if (!campaignEntry) throw bad('campaign.json missing');
    const campaign = await readValidated(host, campaignEntry.path, 'campaign', CampaignFile);
    if (campaign.id !== manifest.data.campaignId) throw bad('Manifest campaign id mismatch');
    const scenes: Scene[] = [];
    const snapshots: { session: string; label: string; value: Snapshot }[] = [];
    const logs: { session: string; path: string }[] = [];
    for (const item of staged.values()) {
      const k = item.kind;
      if (k.kind === 'scene') {
        const scene = await readValidated(host, item.path, 'scene', Scene);
        if (scene.id !== k.id) throw bad('Scene id does not match its file name');
        scenes.push(scene);
      } else if (k.kind === 'snapshot') {
        snapshots.push({
          session: k.session,
          label: k.label,
          value: await readValidated(host, item.path, 'snapshot', Snapshot),
        });
      } else if (k.kind === 'log') {
        for await (const line of createInterface({ input: createReadStream(item.path) })) {
          if (line.trim() === '') continue;
          let entry: LogEntry;
          try {
            entry = LogEntry.parse(JSON.parse(line));
          } catch {
            throw bad(`Invalid log entry in session ${k.session}`);
          }
          if (entry.envelope.campaignId !== campaign.id || entry.envelope.sessionId !== k.session)
            throw bad(`Log entry for another campaign or session in ${k.session}`);
        }
        logs.push({ session: k.session, path: item.path });
      }
    }

    // 5. never overwrite: an existing campaign id is a conflict.
    if (await host.exists(campaign.id))
      throw new ArchiveError(`Campaign ${campaign.id} already exists`, 'conflict');

    // 6. write. campaign.json goes last so a partial import is never listed.
    for (const item of staged.values()) {
      if (item.kind.kind !== 'asset') continue;
      const wanted = expectedAssets.get(item.kind.hash);
      if (wanted && host.assets)
        await host.assets.put(item.kind.hash, createReadStream(item.path), {
          mime: wanted.mime,
          size: wanted.size,
          ext: wanted.ext,
        });
    }
    createdCampaign = campaign.id;
    for (const scene of scenes) await host.saveScene(campaign.id, scene);
    for (const s of snapshots) await host.writeSnapshot(campaign.id, s.session, s.label, s.value);
    for (const log of logs) {
      let batch: LogEntry[] = [];
      for await (const line of createInterface({ input: createReadStream(log.path) })) {
        if (line.trim() === '') continue;
        batch.push(LogEntry.parse(JSON.parse(line)));
        if (batch.length >= 500) {
          await host.appendLog(campaign.id, log.session, batch);
          batch = [];
        }
      }
      await host.appendLog(campaign.id, log.session, batch);
    }
    await host.flushLogs();
    await host.saveCampaign(campaign.id, campaign);
    createdCampaign = undefined;
    return {
      campaignId: campaign.id,
      name: campaign.name,
      scenes: scenes.length,
      assets: expectedAssets.size,
    };
  } catch (error) {
    if (createdCampaign) {
      await host.flushLogs().catch(() => undefined);
      await rm(host.folder(createdCampaign), { recursive: true, force: true });
    }
    throw error;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function parseJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    throw bad('Invalid JSON in archive');
  }
}
async function readValidated<T>(
  host: ArchiveHost,
  path: string,
  kind: 'campaign' | 'scene' | 'snapshot',
  schema: z.ZodType<T>,
): Promise<T> {
  try {
    return await host.readFile(path, kind, schema);
  } catch (error) {
    throw bad(`Invalid ${kind} file: ${error instanceof Error ? error.message : String(error)}`);
  }
}
