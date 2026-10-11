import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { createSpectatorLinks } from './spectator-links.js';

it('stores only hashes, persists across reopen, isolates campaigns, and invalidates rotated or revoked links', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mythic-watch-'));
  const path = join(dir, 'index.sqlite');
  let links = createSpectatorLinks(path, 'campaign-a');
  const other = createSpectatorLinks(path, 'campaign-b');
  try {
    const token = links.rotate();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(links.valid(token)).toBe(true);
    expect(other.valid(token)).toBe(false);
    const db = new Database(path);
    try {
      expect(JSON.stringify(db.prepare('SELECT * FROM spectator_links').all())).not.toContain(
        token,
      );
    } finally {
      db.close();
    }
    links.close();
    links = createSpectatorLinks(path, 'campaign-a');
    expect(links.valid(token)).toBe(true);
    const next = links.rotate();
    expect(links.valid(token)).toBe(false);
    expect(links.valid(next)).toBe(true);
    for (const invalid of ['', 'x', 'x'.repeat(44), '/'.repeat(43)])
      expect(links.valid(invalid)).toBe(false);
    links.revoke();
    expect(links.valid(next)).toBe(false);
  } finally {
    links.close();
    other.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
