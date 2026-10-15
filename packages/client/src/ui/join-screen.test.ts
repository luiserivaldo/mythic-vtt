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
  joinSeatRows,
  joinView,
  loadProfile,
  parseJoinPayload,
  parseProfile,
  saveProfile,
  withoutSpectator,
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
    saveProfile(kv, { displayName: 'Ana', spectator: true, lastSeatId: tid(20) });
    expect(loadProfile(kv)).toEqual({ displayName: 'Ana', spectator: true, lastSeatId: tid(20) });
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
  expect(withoutSpectator(profile)).toEqual({ displayName: 'Colour Guest', color: '#aabbcc' });
  expect(parseProfile(JSON.stringify({ displayName: 'Guest', color: 'url(secret)' }))).toEqual({
    displayName: 'Guest',
  });
});
