import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import Database from 'better-sqlite3';

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * SES-04: per-seat invite credentials. Like spectator links they are access metadata kept in the
 * host's SQLite, never on `Seat` (campaign state is sent to clients, exported and logged). Only a
 * SHA-256 of the 32-byte random token is stored: the token is high-entropy, so a fast hash is
 * enough and keeps validation cheap for an unauthenticated-ish endpoint.
 */
export function createSeatInvites(path: string, campaignId: string) {
  const db = new Database(path);
  db.pragma('busy_timeout = 2000');
  db.exec(
    `CREATE TABLE IF NOT EXISTS seat_invites (
      campaign_id TEXT NOT NULL,
      seat_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      PRIMARY KEY (campaign_id, seat_id)
    )`,
  );
  const read = db.prepare<[string, string], { token_hash: string }>(
    'SELECT token_hash FROM seat_invites WHERE campaign_id = ? AND seat_id = ?',
  );
  const write = db.prepare<[string, string, string]>(
    'INSERT INTO seat_invites VALUES (?, ?, ?) ON CONFLICT(campaign_id, seat_id) DO UPDATE SET token_hash = excluded.token_hash',
  );
  const remove = db.prepare<[string, string]>(
    'DELETE FROM seat_invites WHERE campaign_id = ? AND seat_id = ?',
  );
  const list = db.prepare<[string], { seat_id: string }>(
    'SELECT seat_id FROM seat_invites WHERE campaign_id = ? ORDER BY seat_id',
  );
  const hash = (token: string) => createHash('sha256').update(token).digest();
  return {
    /** Issues a fresh token; any earlier link for this seat stops working at once. */
    rotate(seatId: string): string {
      const token = randomBytes(32).toString('base64url');
      write.run(campaignId, seatId, hash(token).toString('hex'));
      return token;
    },
    revoke(seatId: string): void {
      remove.run(campaignId, seatId);
    },
    valid(seatId: string, token: string): boolean {
      if (!TOKEN.test(token)) return false;
      const stored = read.get(campaignId, seatId)?.token_hash;
      return stored !== undefined && timingSafeEqual(hash(token), Buffer.from(stored, 'hex'));
    },
    /** Seats that currently have an active link. Never returns secrets. */
    seatIds(): string[] {
      return list.all(campaignId).map((row) => row.seat_id);
    },
    close(): void {
      db.close();
    },
  };
}
export type SeatInvites = ReturnType<typeof createSeatInvites>;
