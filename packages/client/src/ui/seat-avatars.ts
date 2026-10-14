import type { ServerMessage } from '@mythic/protocol';
import type { Campaign } from '@mythic/shared';

/**
 * UI-TOP-06: the seat status dot's tuning values, in one named place. The wireframe reads "under
 * 100 ms good, 100 to 300 ms poor, over 300 ms bad", so the good bound is exclusive and the poor
 * bound inclusive: 99 ms is good, exactly 100 ms and exactly 300 ms are poor, 301 ms is bad.
 */
export const SEAT_QUALITY_THRESHOLDS = {
  goodBelowMs: 100,
  poorUpToMs: 300,
} as const;

/**
 * UI-TOP-06: the dot's states. `unknown` covers a seat that is online before the host has measured
 * its first round trip (the wire sends `latencyMs: null` then); it shares the grey dot because no
 * measurement is neither good nor bad, and its words keep it apart from `offline` without colour.
 */
export type SeatQuality = 'good' | 'poor' | 'bad' | 'offline' | 'unknown';

/** The traffic-light tone a dot paints; a style hook, never the only carrier of meaning. */
export type SeatTone = 'green' | 'orange' | 'red' | 'grey';

/** The state in words, for the dot's accessible name and title. */
export const SEAT_QUALITY_TEXT: Record<SeatQuality, string> = {
  good: 'Good connection',
  poor: 'Poor connection',
  bad: 'Bad connection',
  offline: 'Offline',
  unknown: 'Latency not measured yet',
};

export const SEAT_QUALITY_TONE: Record<SeatQuality, SeatTone> = {
  good: 'green',
  poor: 'orange',
  bad: 'red',
  offline: 'grey',
  unknown: 'grey',
};

/** One seat entry of a `presence` message, exactly as the client store holds it. */
export type PresenceSeat = Extract<ServerMessage, { t: 'presence' }>['seats'][number];

/** The round trip worth showing, or null when the host has no usable reading for the seat. */
function measuredMs(latencyMs: number | null): number | null {
  return latencyMs !== null && Number.isFinite(latencyMs) ? latencyMs : null;
}

/**
 * SES-07: map a seat's presence to the dot's state. A disconnected seat is offline even when the
 * last latency reading is still attached to it.
 */
export function seatQuality(connected: boolean, latencyMs: number | null): SeatQuality {
  if (!connected) return 'offline';
  const ms = measuredMs(latencyMs);
  if (ms === null) return 'unknown';
  if (ms < SEAT_QUALITY_THRESHOLDS.goodBelowMs) return 'good';
  if (ms <= SEAT_QUALITY_THRESHOLDS.poorUpToMs) return 'poor';
  return 'bad';
}

export interface SeatAvatar {
  /** The seat's id, used as the React key. */
  id: string;
  /** The seat label from the campaign, e.g. "Seat 2". */
  label: string;
  /** The name the occupant connected with, or the seat label when the host sent no name. */
  name: string;
  /** The occupant's player colour, or undefined so the badge derives one from the name. */
  color: string | undefined;
  connected: boolean;
  latencyMs: number | null;
  quality: SeatQuality;
  tone: SeatTone;
  /** The state in words: the dot's accessible name and title. */
  stateText: string;
  /** Hover and focus text: the seat's name and its latency in ms (or the state when there is none). */
  detail: string;
  /** Screen-reader text for the focusable avatar: the seat, the occupant and the latency. */
  summary: string;
}

/**
 * SES-07 + PERM-03: one row per *occupied* seat, joined with the presence the host sent. Called
 * with a null feed (every player and spectator: the roster is host-only on the wire) it returns
 * nothing, so no seat data is invented for viewers the host does not inform.
 */
export function seatAvatars(
  campaign: Campaign | null,
  presence: readonly PresenceSeat[] | null,
): SeatAvatar[] {
  if (campaign === null || presence === null) return [];
  const bySeat = new Map(presence.map((entry) => [entry.seatId, entry]));
  return Object.values(campaign.seats)
    .filter((seat) => seat.identityId !== null)
    .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
    .map((seat) => {
      const entry = bySeat.get(seat.id);
      const connected = entry?.connected ?? false;
      const latencyMs = entry?.latencyMs ?? null;
      const quality = seatQuality(connected, latencyMs);
      const stateText = SEAT_QUALITY_TEXT[quality];
      const sentName = entry?.displayName;
      const named = sentName !== undefined && sentName !== '';
      const name = named ? sentName : seat.label;
      const ms = measuredMs(latencyMs);
      // The seat label already names the seat, so the occupant only joins when it differs.
      const who = named ? `${seat.label} · ${name}` : seat.label;
      return {
        id: seat.id,
        label: seat.label,
        name,
        color: entry?.color,
        connected,
        latencyMs,
        quality,
        tone: SEAT_QUALITY_TONE[quality],
        stateText,
        detail: ms === null ? `${who} · ${stateText}` : `${who} · ${String(ms)} ms`,
        summary: ms === null ? who : `${who} · ${String(ms)} ms`,
      };
    });
}
