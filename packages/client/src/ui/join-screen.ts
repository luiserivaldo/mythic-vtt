import type { Campaign } from '@mythic/shared';
import type { KeyValueStore } from '../net/identity.js';

// SES-01 / SES-02 / SES-06: the join screen's rules, kept free of React and the DOM so they can be
// tested directly. Nothing here is a secret: the profile is a display name, an optional small
// avatar and two UI hints. The identity secret lives in `net/identity.ts` and is never touched here.

export const DISPLAY_NAME_MAX = 40;
/** A hello carries the avatar, so keep it small (the protocol caps it at 32768 characters). */
export const AVATAR_MAX_CHARS = 24_000;
export const AVATAR_PIXELS = 96;

export interface Profile {
  displayName: string;
  /** Small image data URL; absent when the visitor chose none. */
  avatar?: string;
  /** The visitor explicitly chose to watch; skips the seat picker on later visits. */
  spectator?: boolean;
  /** The seat this identity last sat in, so it can be marked and preselected (SES-06). */
  lastSeatId?: string;
}

/** Trimmed 1..40 characters, or null when it cannot be used. */
export function cleanDisplayName(raw: string): string | null {
  const name = raw.trim();
  return name.length >= 1 && name.length <= DISPLAY_NAME_MAX ? name : null;
}

const AVATAR_PATTERN = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

export function isValidAvatar(value: string): boolean {
  return value.length <= AVATAR_MAX_CHARS && AVATAR_PATTERN.test(value);
}

/** Two-letter-at-most initial for the no-avatar badge. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => Array.from(w)[0] ?? '');
  return letters.join('').toUpperCase() || '?';
}

/** Stable hue from the name, so the same person keeps the same badge colour. */
export function avatarHue(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + (ch.codePointAt(0) ?? 0)) % 360;
  return h;
}

const PROFILE_KEY = 'mythic.profile.v1';

export function parseProfile(raw: string | null): Profile | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null) return null;
    const o = v as Record<string, unknown>;
    const displayName =
      typeof o['displayName'] === 'string' ? cleanDisplayName(o['displayName']) : null;
    if (displayName === null) return null;
    const avatar = o['avatar'];
    const lastSeatId = o['lastSeatId'];
    return {
      displayName,
      ...(typeof avatar === 'string' && isValidAvatar(avatar) ? { avatar } : {}),
      ...(o['spectator'] === true ? { spectator: true } : {}),
      ...(typeof lastSeatId === 'string' && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(lastSeatId)
        ? { lastSeatId }
        : {}),
    };
  } catch {
    return null;
  }
}

export function loadProfile(storage: Pick<KeyValueStore, 'getItem'>): Profile | null {
  try {
    return parseProfile(storage.getItem(PROFILE_KEY));
  } catch {
    return null;
  }
}

export function saveProfile(storage: Pick<KeyValueStore, 'setItem'>, profile: Profile): void {
  try {
    storage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // Private mode: the visitor just sees the screen again next time.
  }
}

/** Drops the explicit-spectator choice (the visitor sat down or asked for a seat again). */
export function withoutSpectator(profile: Profile): Profile {
  return {
    displayName: profile.displayName,
    ...(profile.avatar !== undefined ? { avatar: profile.avatar } : {}),
    ...(profile.lastSeatId !== undefined ? { lastSeatId: profile.lastSeatId } : {}),
  };
}

export type SeatState = 'free' | 'taken' | 'mine';

export interface SeatChoice {
  id: string;
  label: string;
  roleLabel: string;
  state: SeatState;
  /** The seat this identity last sat in (SES-06). */
  previous: boolean;
  disabled: boolean;
}

/**
 * The picker rows: free seats are selectable, taken ones are disabled, this identity's own seat is
 * marked. `identityId` comes from the seat binding already in the visitor's snapshot.
 */
export function seatChoices(
  campaign: Campaign,
  identityId: string,
  lastSeatId: string | undefined,
): SeatChoice[] {
  return Object.values(campaign.seats)
    .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
    .map((seat) => {
      const state: SeatState =
        seat.identityId === null ? 'free' : seat.identityId === identityId ? 'mine' : 'taken';
      return {
        id: seat.id,
        label: seat.label,
        roleLabel:
          seat.role === 'codm'
            ? 'Co-DM'
            : !seat.permissions.move && !seat.permissions.edit && !seat.permissions.delete
              ? 'Spectator'
              : 'Player',
        state,
        previous: seat.id === lastSeatId || state === 'mine',
        disabled: state === 'taken',
      };
    });
}

/** Preselect your own seat, else your previous seat if still free, else nothing. */
export function defaultSeat(choices: readonly SeatChoice[]): string | null {
  const own = choices.find((c) => c.state === 'mine');
  if (own) return own.id;
  const previous = choices.find((c) => c.previous && !c.disabled);
  return previous?.id ?? null;
}

/** Keep a selection only while its seat is still free (someone may take it meanwhile). */
export function validSelection(
  choices: readonly SeatChoice[],
  selected: string | null,
): string | null {
  const row = choices.find((c) => c.id === selected);
  return row && !row.disabled ? row.id : null;
}

export interface JoinFlowInput {
  hostVisitor: boolean;
  started: boolean;
  editingName: boolean;
  ready: boolean;
  seatId: string | null;
  spectator: boolean;
}

export type JoinStep = 'name' | 'connecting' | 'seat' | 'done';

/** Which screen to show. Host and DM-link visitors never see one (the DM link skips it). */
export function joinStep(i: JoinFlowInput): JoinStep {
  if (i.hostVisitor) return 'done';
  if (!i.started || i.editingName) return 'name';
  if (!i.ready) return 'connecting';
  if (i.seatId !== null || i.spectator) return 'done';
  return 'seat';
}

/** Down-scaled image size that keeps the aspect ratio and fits a square of `max` pixels. */
export function fitSize(width: number, height: number, max: number): { w: number; h: number } {
  const scale = Math.min(1, max / Math.max(width, height, 1));
  return { w: Math.max(1, Math.round(width * scale)), h: Math.max(1, Math.round(height * scale)) };
}
