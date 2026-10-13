import Database from 'better-sqlite3';

/**
 * M4-02 / SES-11: the DM-chosen spectator source seat. Access metadata like the spectator link:
 * kept beside it in `index.sqlite`, never in campaign state, exports or the action log, so the
 * save format and protocol are untouched. `null` is the default player view.
 */
export function createSpectatorView(path: string, campaignId: string) {
  const db = new Database(path);
  db.pragma('busy_timeout = 2000');
  db.exec('CREATE TABLE IF NOT EXISTS spectator_view (campaign_id TEXT PRIMARY KEY, seat_id TEXT)');
  const read = db.prepare<[string], { seat_id: string | null }>(
    'SELECT seat_id FROM spectator_view WHERE campaign_id = ?',
  );
  const write = db.prepare<[string, string | null]>(
    'INSERT INTO spectator_view VALUES (?, ?) ON CONFLICT(campaign_id) DO UPDATE SET seat_id = excluded.seat_id',
  );
  return {
    get(): string | null {
      return read.get(campaignId)?.seat_id ?? null;
    },
    set(seatId: string | null): void {
      write.run(campaignId, seatId);
    },
    close(): void {
      db.close();
    },
  };
}
export type SpectatorView = ReturnType<typeof createSpectatorView>;
