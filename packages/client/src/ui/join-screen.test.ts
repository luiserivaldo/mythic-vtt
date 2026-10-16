import { describe, expect, it } from 'vitest';
import type { JoinPayload } from '@mythic/protocol';
import { tid } from '../testing.js';
import {
  AVATAR_MAX_CHARS,
  avatarHue,
  cleanDisplayName,
  fitSize,
  initialsOf,
  isValidAvatar,
  JOIN_POLL_MAX_MS,
  JOIN_POLL_MS,
  joinSeatRows,
  joinView,
  loadProfile,
  migrateLegacyProfile,
  nextJoinPollMs,
  parseJoinPayload,
  parseProfile,
  saveProfile,
  withoutAwaitingSeat,
  type JoinViewInput,
} from './join-screen.js';
import { rosterOptions } from './seat-panel.js';

function payload(): JoinPayload {
  return {
    protocol: 10,
    host: { name: 'Game Master' },
    campaign: { title: 'Vault', icon: { kind: 'glyph', value: 'V' } },
    sceneActive: true,
    seats: [
      { seatId: tid(20), label: 'Wizard', role: 'player', claim: 'free' },
      { seatId: tid(21), label: 'Rogue', role: 'player', claim: 'claimed' },
      { seatId: tid(22), label: 'Cleric', role: 'codm', claim: 'free' },
    ],
  };
}

describe('cleanDisplayName', () => {
  it('trims and enforces 1..40 characters', () => {
    expect(cleanDisplayName('  Ana  ')).toBe('Ana');
    expect(cleanDisplayName('   ')).toBeNull();
    expect(cleanDisplayName('')).toBeNull();
    expect(cleanDisplayName('x'.repeat(40))).toHaveLength(40);
    expect(cleanDisplayName('x'.repeat(41))).toBeNull();
  });
});

describe('avatar helpers', () => {
  it('accepts only small image data URLs', () => {
    expect(isValidAvatar('data:image/png;base64,AAAA')).toBe(true);
    expect(isValidAvatar('data:image/svg+xml;base64,AAAA')).toBe(false);
    expect(isValidAvatar('https://example.com/a.png')).toBe(false);
    expect(isValidAvatar(`data:image/png;base64,${'A'.repeat(AVATAR_MAX_CHARS)}`)).toBe(false);
  });
  it('derives initials and a stable hue', () => {
    expect(initialsOf('ana maria lopez')).toBe('AM');
    expect(initialsOf('  ')).toBe('?');
    expect(avatarHue('Ana')).toBe(avatarHue('Ana'));
    expect(avatarHue('Ana')).toBeLessThan(360);
  });
  it('fits an image into the size limit without upscaling', () => {
    expect(fitSize(1000, 500, 100)).toEqual({ w: 100, h: 50 });
    expect(fitSize(40, 20, 100)).toEqual({ w: 40, h: 20 });
  });
});

describe('profile persistence', () => {
  it('round-trips and drops invalid parts', () => {
    const store = new Map<string, string>();
    const kv = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    expect(loadProfile(kv)).toBeNull();
    saveProfile(kv, { displayName: 'Ana', awaitingSeat: true, lastSeatId: tid(20) });
    expect(loadProfile(kv)).toEqual({
      displayName: 'Ana',
      awaitingSeat: true,
      lastSeatId: tid(20),
    });
    expect(parseProfile('{"displayName":"","avatar":"x"}')).toBeNull();
    expect(
      parseProfile('{"displayName":"Ana","avatar":"javascript:1","lastSeatId":"nope"}'),
    ).toEqual({
      displayName: 'Ana',
    });
    expect(parseProfile('not json')).toBeNull();
  });
  it('survives storage that throws', () => {
    const bad = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadProfile(bad)).toBeNull();
    expect(() => {
      saveProfile(bad, { displayName: 'Ana' });
    }).not.toThrow();
  });
});

describe('join seat rows (UI-JOIN-01)', () => {
  it('sorts by name, marks claimed seats and the last seat', () => {
    const rows = joinSeatRows(payload(), tid(20));
    expect(rows.map((r) => [r.label, r.roleLabel, r.claimed, r.previous])).toEqual([
      ['Cleric', 'Co-DM', false, false],
      ['Rogue', 'Player', true, false],
      ['Wizard', 'Player', false, true],
    ]);
  });
  it('never offers Claim on a co-DM seat, free or not (MV-269)', () => {
    const rows = joinSeatRows(payload(), tid(22));
    expect(rows.map((r) => [r.label, r.claimable])).toEqual([
      ['Cleric', false],
      ['Rogue', false],
      ['Wizard', true],
    ]);
  });
  it('shows an empty list when the DM has made no seats', () => {
    expect(joinSeatRows({ ...payload(), seats: [] }, undefined)).toEqual([]);
  });
  it('accepts only a strict join payload', () => {
    expect(parseJoinPayload(payload())).toEqual(payload());
    expect(parseJoinPayload({ ...payload(), spectators: 3 })).toBeNull();
    expect(parseJoinPayload({ error: 'too many requests' })).toBeNull();
  });
});

describe('joinView', () => {
  const base: JoinViewInput = {
    hostVisitor: false,
    started: false,
    ready: false,
    seatId: null,
    naming: null,
    pending: null,
    watching: false,
    sceneActive: true,
    noScene: false,
  };
  it.each([
    [{ hostVisitor: true }, 'done'],
    [{}, 'pick'],
    [{ sceneActive: null }, 'loading'],
    [{ sceneActive: false }, 'waiting'],
    [{ naming: { kind: 'temporary' } }, 'name'],
    [{ started: true }, 'connecting'],
    [{ started: true, ready: true, pending: { kind: 'claim', seatId: tid(20) } }, 'connecting'],
    [{ started: true, ready: true, seatId: tid(20) }, 'done'],
    [{ started: true, ready: true, watching: true }, 'watching'],
    [{ started: true, ready: true }, 'pick'],
    [{ started: true, ready: true, noScene: true }, 'waiting'],
    [{ started: true, ready: true, seatId: tid(20), noScene: true }, 'waiting'],
  ] as const)('%j -> %s', (over, view) => {
    expect(joinView({ ...base, ...over })).toBe(view);
  });
});

describe('rosterOptions', () => {
  it('labels unseated identities and tolerates a missing roster', () => {
    expect(rosterOptions(undefined)).toEqual([]);
    expect(rosterOptions([{ identityId: tid(10), displayName: 'Ana' }])).toEqual([
      { identityId: tid(10), label: `Ana (${tid(10).slice(-4)})` },
    ]);
  });
});

it('validates and preserves the chosen colour across profile persistence', () => {
  const profile = parseProfile(
    JSON.stringify({ displayName: 'Colour Guest', color: '#AABBCC', spectator: true }),
  );
  expect(profile?.color).toBe('#aabbcc');
  if (!profile) throw new Error('profile missing');
  // MV-270: the legacy spectator flag is read as awaitingSeat.
  expect(profile).toEqual({ displayName: 'Colour Guest', color: '#aabbcc', awaitingSeat: true });
  expect(withoutAwaitingSeat(profile)).toEqual({ displayName: 'Colour Guest', color: '#aabbcc' });
  expect(parseProfile(JSON.stringify({ displayName: 'Guest', color: 'url(secret)' }))).toEqual({
    displayName: 'Guest',
  });
});

describe('legacy spectator profiles (MV-270)', () => {
  const kvWith = (raw: string | null) => {
    const store = new Map<string, string>();
    if (raw !== null) store.set('mythic.profile.v1', raw);
    return {
      store,
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
  };
  it('rewrites a stored spectator flag as awaitingSeat and keeps the rest of the profile', () => {
    const kv = kvWith(
      JSON.stringify({
        displayName: 'Ana',
        color: '#AABBCC',
        spectator: true,
        lastSeatId: tid(20),
      }),
    );
    expect(migrateLegacyProfile(kv)).toBe(true);
    expect(JSON.parse(kv.store.get('mythic.profile.v1') ?? '{}')).toEqual({
      displayName: 'Ana',
      color: '#aabbcc',
      awaitingSeat: true,
      lastSeatId: tid(20),
    });
    expect(migrateLegacyProfile(kv)).toBe(false);
  });
  it('leaves a current, missing or unusable profile alone', () => {
    const current = kvWith(JSON.stringify({ displayName: 'Ana' }));
    expect(migrateLegacyProfile(current)).toBe(false);
    expect(current.store.get('mythic.profile.v1')).toBe('{"displayName":"Ana"}');
    expect(migrateLegacyProfile(kvWith(null))).toBe(false);
    const broken = kvWith('{"spectator":true}');
    expect(migrateLegacyProfile(broken)).toBe(false);
    expect(broken.store.get('mythic.profile.v1')).toBe('{"spectator":true}');
    expect(migrateLegacyProfile(kvWith('not json'))).toBe(false);
  });
});

describe('join screen polling (MV-270)', () => {
  it('polls every 10 s, which keeps ten screens behind one address under 60 a minute', () => {
    expect(nextJoinPollMs(200, null, JOIN_POLL_MS)).toBe(JOIN_POLL_MS);
    expect(10 * (60_000 / JOIN_POLL_MS)).toBeLessThanOrEqual(60);
    // A recovered poll returns to the normal pace.
    expect(nextJoinPollMs(200, null, JOIN_POLL_MAX_MS)).toBe(JOIN_POLL_MS);
    expect(nextJoinPollMs(500, null, JOIN_POLL_MS)).toBe(JOIN_POLL_MS);
  });
  it('waits for the Retry-After seconds on a 429, within bounds', () => {
    expect(nextJoinPollMs(429, '37', JOIN_POLL_MS)).toBe(37_000);
    expect(nextJoinPollMs(429, '1', JOIN_POLL_MS)).toBe(JOIN_POLL_MS);
    expect(nextJoinPollMs(429, '86400', JOIN_POLL_MS)).toBe(JOIN_POLL_MAX_MS);
  });
  it('doubles the wait on a 429 without a usable Retry-After, up to the cap', () => {
    expect(nextJoinPollMs(429, null, JOIN_POLL_MS)).toBe(2 * JOIN_POLL_MS);
    expect(nextJoinPollMs(429, 'Wed, 21 Oct 2026 07:28:00 GMT', 40_000)).toBe(80_000);
    expect(nextJoinPollMs(429, null, 100_000)).toBe(JOIN_POLL_MAX_MS);
  });
});
