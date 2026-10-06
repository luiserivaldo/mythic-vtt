import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import { createReadStream } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { atomicWrite } from './io.js';
import { assets } from './index-schema.js';
import { AssetMeta, StorageDataError, type AssetStore } from './types.js';

const digest = (hash: string): string => {
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new StorageDataError('Invalid asset hash', 'corrupt');
  return hash;
};

export class LocalAssetStore implements AssetStore {
  private readonly db: Database.Database;
  private readonly index;
  constructor(private readonly root: string) {
    mkdirSync(root, { recursive: true });
    this.db = new Database(join(root, 'index.sqlite'));
    this.index = drizzle(this.db);
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS assets (hash TEXT PRIMARY KEY, mime TEXT NOT NULL, size INTEGER NOT NULL, ext TEXT NOT NULL)',
    );
  }
  has(hash: string): Promise<boolean> {
    return Promise.resolve(
      this.index
        .select({ hash: assets.hash })
        .from(assets)
        .where(eq(assets.hash, digest(hash)))
        .get() !== undefined,
    );
  }
  async put(hash: string, data: Readable, meta: AssetMeta): Promise<void> {
    const parsed = AssetMeta.parse(meta);
    const key = digest(hash);
    if (await this.has(key)) return;
    const hashState = createHash('sha256');
    let size = 0;
    const verified = data.pipe(
      new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          hashState.update(chunk);
          size += chunk.length;
          callback(null, chunk);
        },
      }),
    );
    await atomicWrite(join(this.root, 'assets', `${key}.${parsed.ext}`), verified, () => {
      if (hashState.digest('hex') !== key || size !== parsed.size)
        throw new StorageDataError('Asset hash or size mismatch', 'corrupt');
    });
    this.index
      .insert(assets)
      .values({ hash: key, ...parsed })
      .onConflictDoNothing()
      .run();
  }
  get(hash: string): Promise<Readable> {
    const key = digest(hash);
    const row = this.db.prepare('SELECT ext FROM assets WHERE hash = ?').get(key) as
      { ext: string } | undefined;
    if (!row) throw new StorageDataError('Asset not found', 'not-found');
    return Promise.resolve(createReadStream(join(this.root, 'assets', `${key}.${row.ext}`)));
  }
  /** Stored metadata (mime/size/ext) for export; undefined when the asset is unknown. */
  meta(hash: string): Promise<AssetMeta | undefined> {
    const row = this.db
      .prepare('SELECT mime, size, ext FROM assets WHERE hash = ?')
      .get(digest(hash)) as AssetMeta | undefined;
    return Promise.resolve(row);
  }
  close(): void {
    this.db.close();
  }
}
