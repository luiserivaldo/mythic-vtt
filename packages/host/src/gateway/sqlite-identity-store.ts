import Database from 'better-sqlite3';
import type { IdentityStore, StoredIdentity } from './identity-store.js';

interface IdentityRow {
  identity_id: string;
  secret_hash: string;
  display_name: string;
  avatar: string | null;
}

const toIdentity = (row: IdentityRow): StoredIdentity => ({
  identityId: row.identity_id,
  secretHash: row.secret_hash,
  displayName: row.display_name,
  ...(row.avatar !== null ? { avatar: row.avatar } : {}),
});

/**
 * `IdentityStore` in the host's SQLite index (§8.2: "identities (hashed secrets)"), so returning
 * players keep their identity and the D24 host binding survives a restart. The binding is
 * replaced when a fresh startup token is presented (D29 rebind). Uses its own
 * connection and tables; better-sqlite3 is synchronous, so each method is atomic in-process.
 */
export function createSqliteIdentityStore(path: string): IdentityStore & { close(): void } {
  const db = new Database(path);
  db.pragma('busy_timeout = 2000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS identities (
      identity_id TEXT PRIMARY KEY,
      secret_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      avatar TEXT
    );
    CREATE TABLE IF NOT EXISTS host_binding (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      identity_id TEXT NOT NULL
    );
  `);
  const selectIdentity = db.prepare<[string], IdentityRow>(
    'SELECT identity_id, secret_hash, display_name, avatar FROM identities WHERE identity_id = ?',
  );
  const insertIdentity = db.prepare<[string, string, string, string | null]>(
    'INSERT OR IGNORE INTO identities (identity_id, secret_hash, display_name, avatar) VALUES (?, ?, ?, ?)',
  );
  const updateName = db.prepare<[string, string]>(
    'UPDATE identities SET display_name = ? WHERE identity_id = ?',
  );
  const updateNameAvatar = db.prepare<[string, string, string]>(
    'UPDATE identities SET display_name = ?, avatar = ? WHERE identity_id = ?',
  );
  const selectHost = db.prepare<[], { identity_id: string }>(
    'SELECT identity_id FROM host_binding WHERE id = 1',
  );
  const upsertHost = db.prepare<[string]>(
    'INSERT INTO host_binding (id, identity_id) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET identity_id = excluded.identity_id',
  );
  // Read-then-replace in one transaction so the returned previous host is exact.
  const rebind = db.transaction((identityId: string) => {
    const previous = hostId();
    upsertHost.run(identityId);
    return previous;
  });

  const hostId = () => selectHost.get()?.identity_id;

  return {
    get: (identityId) => Promise.resolve(mapRow(selectIdentity.get(identityId))),
    registerIfAbsent(candidate) {
      insertIdentity.run(
        candidate.identityId,
        candidate.secretHash,
        candidate.displayName,
        candidate.avatar ?? null,
      );
      const stored = mapRow(selectIdentity.get(candidate.identityId));
      return stored ? Promise.resolve(stored) : Promise.reject(new Error('identity not stored'));
    },
    update(identityId, patch) {
      if (patch.avatar === undefined) updateName.run(patch.displayName, identityId);
      else updateNameAvatar.run(patch.displayName, patch.avatar, identityId);
      return Promise.resolve();
    },
    getHostIdentityId: () => Promise.resolve(hostId()),
    rebindHost: (identityId) => Promise.resolve(rebind(identityId)),
    close() {
      db.close();
    },
  };
}

function mapRow(row: IdentityRow | undefined): StoredIdentity | undefined {
  return row ? toIdentity(row) : undefined;
}
