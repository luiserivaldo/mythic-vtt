import { describe, expect, it } from 'vitest';
import { makeCampaign, tid } from '../testing.js';
import {
  AVATAR_MAX_CHARS,
  avatarHue,
  cleanDisplayName,
  defaultSeat,
  fitSize,
  initialsOf,
  isValidAvatar,
  joinStep,
  loadProfile,
  parseProfile,
  saveProfile,
  seatChoices,
  validSelection,
  type JoinFlowInput,
} from './join-screen.js';
import { rosterOptions } from './seat-panel.js';

const ME = tid(10);
const OTHER = tid(11);

function campaignWithSeats() {
  const c = makeCampaign();
  const seat = (n: number, label: string, identityId: string | null) => ({
    id: tid(n),
    label,
    binding: 'persistent' as const,
    identityId,
    role: 'player' as const,
    permissions: { view: true, move: true, edit: false, delete: false },
  });
  return {
    ...c,
    seats: {
      [tid(20)]: seat(20, 'Wizard', null),
      [tid(21)]: seat(21, 'Rogue', OTHER),
      [tid(22)]: seat(22, 'Cleric', null),
    },
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

describe('seat picker view model', () => {
  it('enables free seats, disables taken ones and marks the previous seat', () => {
    const rows = seatChoices(campaignWithSeats(), ME, tid(22));
    expect(rows.map((r) => [r.label, r.state, r.disabled, r.previous])).toEqual([
      ['Cleric', 'free', false, true],
      ['Rogue', 'taken', true, false],
      ['Wizard', 'free', false, false],
    ]);
    expect(defaultSeat(rows)).toBe(tid(22));
  });
  it('does not preselect a previous seat that was taken meanwhile', () => {
    const rows = seatChoices(campaignWithSeats(), ME, tid(21));
    expect(defaultSeat(rows)).toBeNull();
  });
  it('marks and preselects your own bound seat (SES-06)', () => {
    const c = campaignWithSeats();
    const wizard = c.seats[tid(20)];
    if (!wizard) throw new Error('fixture');
    const seats = { ...c.seats, [tid(20)]: { ...wizard, identityId: ME } };
    const rows = seatChoices({ ...c, seats }, ME, undefined);
    expect(rows.find((r) => r.id === tid(20))).toMatchObject({ state: 'mine', disabled: false });
    expect(defaultSeat(rows)).toBe(tid(20));
  });
  it('drops a selection once the seat is taken', () => {
    const rows = seatChoices(campaignWithSeats(), ME, undefined);
    expect(validSelection(rows, tid(22))).toBe(tid(22));
    expect(validSelection(rows, tid(21))).toBeNull();
    expect(validSelection(rows, null)).toBeNull();
  });
  it('shows an empty list when the campaign has no seats', () => {
    expect(seatChoices(makeCampaign(), ME, undefined)).toEqual([]);
  });
});

describe('joinStep', () => {
  const base: JoinFlowInput = {
    hostVisitor: false,
    started: true,
    editingName: false,
    ready: true,
    seatId: null,
    spectator: false,
  };
  it.each([
    [{ hostVisitor: true, started: false }, 'done'],
    [{ started: false }, 'name'],
    [{ editingName: true }, 'name'],
    [{ ready: false }, 'connecting'],
    [{}, 'seat'],
    [{ seatId: tid(20) }, 'done'],
    [{ spectator: true }, 'done'],
  ] as const)('%j -> %s', (over, step) => {
    expect(joinStep({ ...base, ...over })).toBe(step);
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
