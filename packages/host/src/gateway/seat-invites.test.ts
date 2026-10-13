import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createSeatInvites } from './seat-invites.js';

const SEAT_A = 'A'.repeat(26);
const SEAT_B = 'B'.repeat(26);

it('stores only hashes, scopes tokens to one seat and campaign, and invalidates rotated or revoked links', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mythic-seat-invite-'));
  const path = join(dir, 'index.sqlite');
  let invites = createSeatInvites(path, 'campaign-a');
  const other = createSeatInvites(path, 'campaign-b');
  try {
    const token = invites.rotate(SEAT_A);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(invites.valid(SEAT_A, token)).toBe(true);
    // A token opens only its own seat, in its own campaign.
    expect(invites.valid(SEAT_B, token)).toBe(false);
    expect(other.valid(SEAT_A, token)).toBe(false);
    for (const bad of ['', 'short', `${token}x`, token.slice(1), '!'.repeat(43)])
      expect(invites.valid(SEAT_A, bad)).toBe(false);
    expect(invites.seatIds()).toEqual([SEAT_A]);
    expect(other.seatIds()).toEqual([]);

    // The raw token must not be on disk, in the table or in the database file.
    invites.close();
    other.close();
    expect(readFileSync(path).toString('latin1')).not.toContain(token);
    invites = createSeatInvites(path, 'campaign-a');
    expect(invites.valid(SEAT_A, token)).toBe(true);

    const next = invites.rotate(SEAT_A);
    expect(next).not.toBe(token);
    expect(invites.valid(SEAT_A, token)).toBe(false);
    expect(invites.valid(SEAT_A, next)).toBe(true);
    const second = invites.rotate(SEAT_B);
    expect(invites.seatIds()).toEqual([SEAT_A, SEAT_B]);
    invites.revoke(SEAT_A);
    expect(invites.valid(SEAT_A, next)).toBe(false);
    expect(invites.valid(SEAT_B, second)).toBe(true);
    expect(invites.seatIds()).toEqual([SEAT_B]);
    invites.revoke(SEAT_A); // idempotent
  } finally {
    invites.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
