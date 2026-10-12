import { contrastRatio, LABEL_BACKGROUND_COLOR, LABEL_TEXT_COLOR } from '../render/canvas-style.js';

/**
 * UI-CHAT-01 / ACT-01 / ACT-02: the Chat tab's rules, kept free of React so they can be tested
 * directly. Entries arrive from the chat feed (M4-22/M4-23); nothing here talks to the network.
 */

export type ChatEntryKind = 'message' | 'roll';

export interface ChatEntry {
  id: string;
  kind: ChatEntryKind;
  author: string;
  /** The message body, or the roll's short summary ("1d20 + 3 = 17"). */
  text: string;
  /** The seat that produced the entry; absent for a seat-less viewer's own entry. */
  seatId?: string;
  /** The roller's colour, carried with the entry; wins over the seat lookup. */
  color?: string;
}

/** Seat colours a viewer knows, keyed by seat id (presence carries them for the host only). */
export type SeatColors = Readonly<Record<string, string | undefined>>;

/**
 * A seat we know nothing about — never seated, or archived since — keeps the neutral grey. It reads
 * on both dock backgrounds (>=3:1 against the dark and light `--ui-bg` in shell.css).
 */
export const NEUTRAL_ROLL_COLOR = '#7d8b99';

export const CHAT_EMPTY_STATE = 'No messages yet.';
export const CHAT_COMING_SOON =
  'Chat is coming soon. Messages and dice rolls arrive with ACT-01 and ACT-02.';

const HEX = /^#[0-9a-fA-F]{6}$/;

function hex(value: string | undefined): string | null {
  return value !== undefined && HEX.test(value) ? value : null;
}

/** The colours of the connected seats this viewer may see; a seat without one stays absent. */
export function seatColorsOf(
  seats: readonly { seatId: string; color?: string | undefined }[] | null | undefined,
): SeatColors {
  const colors: Record<string, string | undefined> = {};
  for (const seat of seats ?? []) colors[seat.seatId] = hex(seat.color) ?? undefined;
  return colors;
}

/** The colour of a roll row: the roller's own colour, their seat's, else the neutral fallback. */
export function rollColor(
  entry: Pick<ChatEntry, 'color' | 'seatId'>,
  seats: SeatColors = {},
): string {
  const own = hex(entry.color);
  if (own !== null) return own;
  const seat = entry.seatId === undefined ? null : hex(seats[entry.seatId]);
  return seat ?? NEUTRAL_ROLL_COLOR;
}

const ROLL_TEXT_COLORS = [LABEL_BACKGROUND_COLOR, LABEL_TEXT_COLOR] as const;

/** The roll's text colour: whichever of the two reads better on it, so both themes stay legible. */
export function rollTextColor(color: string): string {
  const ratios = ROLL_TEXT_COLORS.map((candidate) => contrastRatio(candidate, color) ?? 0);
  return (ratios[0] ?? 0) >= (ratios[1] ?? 0) ? LABEL_BACKGROUND_COLOR : LABEL_TEXT_COLOR;
}
