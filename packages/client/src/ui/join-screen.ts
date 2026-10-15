import { JoinPayload, PlayerColor } from '@mythic/protocol';
import type { KeyValueStore } from '../net/identity.js';

// SES-01 / SES-02 / SES-06: the join screen's rules, kept free of React and the DOM so they can be
// tested directly. Nothing here is a secret: the profile is a display name, an optional small
// avatar and two UI hints. The identity secret lives in `net/identity.ts` and is never touched here.

export const DISPLAY_NAME_MAX = 40;
export const DEFAULT_PLAYER_COLOR = '#4f86c6';
/** A hello carries the avatar, so keep it small (the protocol caps it at 32768 characters). */
export const AVATAR_MAX_CHARS = 24_000;
export const AVATAR_PIXELS = 96;

export interface Profile {
  displayName: string;
  color?: string;
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
    const color = PlayerColor.safeParse(o['color']);
    const avatar = o['avatar'];
    const lastSeatId = o['lastSeatId'];
    return {
      displayName,
      ...(color.success ? { color: color.data.toLowerCase() } : {}),
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
    ...(profile.color !== undefined ? { color: profile.color } : {}),
    ...(profile.avatar !== undefined ? { avatar: profile.avatar } : {}),
    ...(profile.lastSeatId !== undefined ? { lastSeatId: profile.lastSeatId } : {}),
  };
}

export type JoinIcon = NonNullable<JoinPayload['campaign']['icon']>;

/** UI-JOIN-01: one row of the pre-join seat list, built from `GET /api/join` only. */
export interface JoinSeatRow {
  seatId: string;
  label: string;
  roleLabel: string;
  icon: JoinIcon | undefined;
  /** Someone holds it; the payload never says who (PERM-03). */
  claimed: boolean;
  /** The seat this browser last sat in (SES-06). */
  previous: boolean;
}

export function joinSeatRows(payload: JoinPayload, lastSeatId: string | undefined): JoinSeatRow[] {
  return [...payload.seats]
    .sort((a, b) => a.label.localeCompare(b.label) || a.seatId.localeCompare(b.seatId))
    .map((seat) => ({
      seatId: seat.seatId,
      label: seat.label,
      roleLabel: seat.role === 'codm' ? 'Co-DM' : 'Player',
      icon: seat.icon,
      claimed: seat.claim === 'claimed',
      previous: seat.seatId === lastSeatId,
    }));
}

/** The join payload, or null when the body is not one (an old or foreign host). */
export function parseJoinPayload(body: unknown): JoinPayload | null {
  const parsed = JoinPayload.safeParse(body);
  return parsed.success ? parsed.data : null;
}

/** Image icons are content hashes on the host's public asset route. */
export function joinImageUrl(hash: string): string {
  return `/assets/${hash}`;
}

/**
 * What the visitor asked for. `returning` follows an identity transfer: the name step connects
 * and the host puts a bound identity back in its seat.
 */
export type JoinRequest =
  | { kind: 'claim'; seatId: string }
  | { kind: 'temporary' }
  | { kind: 'spectator' }
  | { kind: 'returning' };

export interface JoinViewInput {
  hostVisitor: boolean;
  started: boolean;
  ready: boolean;
  seatId: string | null;
  /** A request whose name step is open. */
  naming: JoinRequest | null;
  /** A request sent (or about to be sent) on the current connection, not yet answered. */
  pending: JoinRequest | null;
  /** Watching without a seat: an anonymous spectator, or a remembered unseated profile. */
  watching: boolean;
  /** From the join payload; null until it arrives. */
  sceneActive: boolean | null;
  /** Connected, and this visitor has no active scene to play in (UI-TOP-03), seated or not. */
  noScene: boolean;
}

export type JoinView = 'done' | 'name' | 'connecting' | 'watching' | 'waiting' | 'loading' | 'pick';

/** Which screen to show. Host and DM-link visitors never see one. */
export function joinView(i: JoinViewInput): JoinView {
  if (i.hostVisitor) return 'done';
  if (i.noScene) return 'waiting';
  if (i.seatId !== null) return 'done';
  if (i.naming) return 'name';
  if (i.started && (!i.ready || i.pending)) return 'connecting';
  if (i.started && i.watching) return 'watching';
  if (i.sceneActive === false) return 'waiting';
  if (i.sceneActive === null) return 'loading';
  return 'pick';
}

/** Down-scaled image size that keeps the aspect ratio and fits a square of `max` pixels. */
export function fitSize(width: number, height: number, max: number): { w: number; h: number } {
  const scale = Math.min(1, max / Math.max(width, height, 1));
  return { w: Math.max(1, Math.round(width * scale)), h: Math.max(1, Math.round(height * scale)) };
}
