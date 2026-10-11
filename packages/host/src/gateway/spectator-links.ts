import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import Database from 'better-sqlite3';

/** Credentials are access metadata, like the host binding, never exported game state. */
export function createSpectatorLinks(path: string, campaignId: string) {
  const db = new Database(path);
  db.pragma('busy_timeout = 2000');
  db.exec(
    'CREATE TABLE IF NOT EXISTS spectator_links (campaign_id TEXT PRIMARY KEY, token_hash TEXT NOT NULL)',
  );
  const read = db.prepare<[string], { token_hash: string }>(
    'SELECT token_hash FROM spectator_links WHERE campaign_id = ?',
  );
  const write = db.prepare<[string, string]>(
    'INSERT INTO spectator_links VALUES (?, ?) ON CONFLICT(campaign_id) DO UPDATE SET token_hash = excluded.token_hash',
  );
  const remove = db.prepare<[string]>('DELETE FROM spectator_links WHERE campaign_id = ?');
  const hash = (token: string) => createHash('sha256').update(token).digest();
  return {
    rotate(): string {
      const token = randomBytes(32).toString('base64url');
      write.run(campaignId, hash(token).toString('hex'));
      return token;
    },
    revoke(): void {
      remove.run(campaignId);
    },
    valid(token: string): boolean {
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
      const stored = read.get(campaignId)?.token_hash;
      return stored !== undefined && timingSafeEqual(hash(token), Buffer.from(stored, 'hex'));
    },
    close(): void {
      db.close();
    },
  };
}
export type SpectatorLinks = ReturnType<typeof createSpectatorLinks>;
