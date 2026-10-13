import { Presence } from '@mythic/protocol';
import { describe, expect, it } from 'vitest';
import type { Campaign, Seat } from '@mythic/shared';
import { makeCampaign, tid } from '../testing.js';
import {
  SEAT_QUALITY_TEXT,
  SEAT_QUALITY_TONE,
  seatAvatars,
  seatQuality,
  type SeatQuality,
} from './seat-avatars.js';

const A = tid(2);
const B = tid(3);
const C = tid(4);
const OWNER = tid(7);
const OTHER = tid(8);

/** Real `presence` seats: parsed by the protocol schema, exactly as the client store holds them. */
const presenceSeats = (
  ...seats: {
    seatId: string;
    connected: boolean;
    latencyMs: number | null;
    displayName?: string;
  }[]
) => Presence.parse({ t: 'presence', seats, spectators: 0 }).seats;

function seat(id: string, label: string, identityId: string | null): Seat {
  return {
    id,
    label,
    binding: 'persistent',
    identityId,
    role: 'player',
    permissions: { view: true, move: true, edit: false, delete: false },
  };
}

/** Seat 1 and Seat 2 are occupied, Seat 3 is empty. */
function campaignWithSeats(): Campaign {
  return {
    ...makeCampaign(),
    seats: {
      [B]: seat(B, 'Seat 2', OTHER),
      [A]: seat(A, 'Seat 1', OWNER),
      [C]: seat(C, 'Seat 3', null),
    },
  };
}

describe('seatQuality thresholds', () => {
  it('maps a reading under the good threshold to good', () => {
    expect(seatQuality(true, 0)).toBe('good');
    expect(seatQuality(true, 42)).toBe('good');
    expect(seatQuality(true, 99)).toBe('good');
  });

  it('treats the good threshold itself as poor, not good', () => {
    expect(seatQuality(true, 100)).toBe('poor');
  });

  it('maps the poor band, both ends included, to poor', () => {
    expect(seatQuality(true, 101)).toBe('poor');
    expect(seatQuality(true, 200)).toBe('poor');
    expect(seatQuality(true, 300)).toBe('poor');
  });

  it('maps a reading above the poor threshold to bad', () => {
    expect(seatQuality(true, 301)).toBe('bad');
    expect(seatQuality(true, 30_000)).toBe('bad');
  });

  it('reports offline for a disconnected seat, whatever a stale latency says', () => {
    expect(seatQuality(false, null)).toBe('offline');
    expect(seatQuality(false, 42)).toBe('offline');
    expect(seatQuality(false, 5000)).toBe('offline');
  });

  it('reports unknown for a connected seat the host has not measured yet', () => {
    expect(seatQuality(true, null)).toBe('unknown');
    expect(seatQuality(true, Number.NaN)).toBe('unknown');
    expect(seatQuality(true, Number.POSITIVE_INFINITY)).toBe('unknown');
  });

  it('gives every state words of its own, and never colour as the only signal', () => {
    const states: SeatQuality[] = ['good', 'poor', 'bad', 'offline', 'unknown'];
    for (const state of states) expect(SEAT_QUALITY_TEXT[state]).not.toBe('');
    expect(SEAT_QUALITY_TONE).toEqual({
      good: 'green',
      poor: 'orange',
      bad: 'red',
      offline: 'grey',
      unknown: 'grey',
    });
    // The offline state stays readable without colour, and is not confused with "no reading yet".
    expect(SEAT_QUALITY_TEXT.offline).not.toBe(SEAT_QUALITY_TEXT.unknown);
    expect(SEAT_QUALITY_TEXT.offline.toLowerCase()).toContain('offline');
  });
});

describe('seatAvatars rows', () => {
  it('shows one avatar per occupied seat, ordered by label', () => {
    const rows = seatAvatars(
      campaignWithSeats(),
      presenceSeats(
        { seatId: A, connected: true, latencyMs: 42, displayName: 'Ana' },
        { seatId: B, connected: true, latencyMs: 120, displayName: 'Bob' },
        { seatId: C, connected: false, latencyMs: null },
      ),
    );
    expect(rows.map((row) => row.label)).toEqual(['Seat 1', 'Seat 2']);
    expect(rows.map((row) => row.quality)).toEqual(['good', 'poor']);
    expect(rows[0]).toMatchObject({
      id: A,
      name: 'Ana',
      connected: true,
      latencyMs: 42,
      tone: 'green',
      detail: 'Seat 1 · Ana · 42 ms',
    });
  });

  it('keeps an occupied seat the presence feed omits, as offline', () => {
    const rows = seatAvatars(
      campaignWithSeats(),
      presenceSeats({ seatId: A, connected: true, latencyMs: 42, displayName: 'Ana' }),
    );
    expect(rows.map((row) => row.quality)).toEqual(['good', 'offline']);
    expect(rows[1]).toMatchObject({ id: B, tone: 'grey', latencyMs: null });
    expect(rows[1]?.detail).toContain(SEAT_QUALITY_TEXT.offline);
  });

  it('puts the seat name and the latency in the hover and focus text', () => {
    const [row] = seatAvatars(
      campaignWithSeats(),
      presenceSeats({ seatId: A, connected: true, latencyMs: 1234, displayName: 'Ana Maria' }),
    );
    expect(row?.label).toBe('Seat 1');
    expect(row?.name).toBe('Ana Maria');
    expect(row?.detail).toContain('Seat 1');
    expect(row?.detail).toContain('1234 ms');
    expect(row?.detail).not.toContain('Connected');
    expect(row?.summary).toContain('Seat 1');
    expect(row?.summary).toContain('1234 ms');
  });

  it('falls back to the seat label and says so when there is no name or measurement', () => {
    const [row] = seatAvatars(
      campaignWithSeats(),
      presenceSeats({ seatId: A, connected: true, latencyMs: null }),
    );
    expect(row).toMatchObject({
      name: 'Seat 1',
      latencyMs: null,
      quality: 'unknown',
      tone: 'grey',
    });
    expect(row?.stateText).toBe(SEAT_QUALITY_TEXT.unknown);
    expect(row?.detail).toContain(SEAT_QUALITY_TEXT.unknown);
    expect(row?.detail).not.toContain('Connected');
  });

  it('does not repeat the seat label when the host sent no occupant name', () => {
    const [row] = seatAvatars(
      campaignWithSeats(),
      presenceSeats({ seatId: A, connected: false, latencyMs: null }),
    );
    expect(row?.detail).toBe('Seat 1 · Offline');
    expect(row?.summary).toBe('Seat 1');
  });

  it('shows nothing when this viewer receives no presence feed', () => {
    expect(seatAvatars(campaignWithSeats(), null)).toEqual([]);
  });

  it('shows nothing before a campaign arrives', () => {
    expect(seatAvatars(null, presenceSeats({ seatId: A, connected: true, latencyMs: 5 }))).toEqual(
      [],
    );
  });

  it('never carries a task or requirement id into the text a user sees', () => {
    const rows = seatAvatars(
      campaignWithSeats(),
      presenceSeats(
        { seatId: A, connected: true, latencyMs: 42, displayName: 'Ana' },
        { seatId: B, connected: false, latencyMs: null },
      ),
    );
    for (const row of rows) {
      for (const text of [row.detail, row.summary, row.stateText, row.name, row.label]) {
        expect(text).not.toMatch(/UX-|UI-|SES-|\bM\d+-\d+/);
      }
    }
  });
});
