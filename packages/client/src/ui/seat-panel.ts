import { Id, type Campaign, type Seat } from '@mythic/shared';

export const PERMISSION_KEYS = ['view', 'move', 'edit', 'delete'] as const;
export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export interface SeatRow {
  id: string;
  label: string;
  role: Seat['role'];
  roleLabel: string;
  occupied: boolean;
  /** From presence; false when unknown or offline. */
  connected: boolean;
  /** SES-07: the name the seated identity connected with, when the host has told us. */
  occupantName: string | undefined;
  permissions: Record<PermissionKey, boolean>;
}

export function seatRows(
  campaign: Campaign,
  presence:
    readonly { seatId: string; connected: boolean; displayName?: string | undefined }[] | null,
): SeatRow[] {
  const online = new Set((presence ?? []).filter((p) => p.connected).map((p) => p.seatId));
  const names = new Map((presence ?? []).map((p) => [p.seatId, p.displayName]));
  return Object.values(campaign.seats)
    .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
    .map((seat) => ({
      id: seat.id,
      label: seat.label,
      role: seat.role,
      // D24: the UI says "Co-DM" for the stored `codm` role.
      roleLabel: seat.role === 'codm' ? 'Co-DM' : 'Player',
      occupied: seat.identityId !== null,
      connected: online.has(seat.id),
      occupantName: names.get(seat.id),
      permissions: {
        view: seat.permissions.view,
        move: seat.permissions.move,
        edit: seat.permissions.edit,
        delete: seat.permissions.delete,
      },
    }));
}

/** Seat labels are required and trimmed by the action schema; mirror it so the button can disable. */
export const isValidLabel = (text: string): boolean => {
  const t = text.trim();
  return t.length >= 1 && t.length <= 120;
};

/** `seat.assign` needs an identity id (a ULID); the host sees no roster, so it is typed in. */
export const isValidIdentityId = (text: string): boolean => Id.safeParse(text.trim()).success;

export interface RosterOption {
  identityId: string;
  /** "Name (id tail)" so two people called the same are told apart. */
  label: string;
}

export interface ConnectedIdentityRow {
  key: string;
  displayName: string;
  seatLabel: string;
  roleLabel: 'Co-DM' | 'Player' | 'Spectator';
}

/** M1-39: the host-only presence feed, joined to seat labels without exposing it to other clients. */
export function connectedIdentityRows(
  campaign: Campaign,
  presence:
    readonly { seatId: string; connected: boolean; displayName?: string | undefined }[] | null,
  unseated: readonly { identityId: string; displayName: string }[] | undefined,
): ConnectedIdentityRow[] {
  const rows: ConnectedIdentityRow[] = [];
  for (const entry of presence ?? []) {
    if (!entry.connected) continue;
    const seat = campaign.seats[entry.seatId];
    if (!seat) continue;
    rows.push({
      key: `seat-${seat.id}`,
      displayName: entry.displayName ?? 'Unnamed player',
      seatLabel: seat.label,
      roleLabel: seat.role === 'codm' ? 'Co-DM' : 'Player',
    });
  }
  for (const entry of unseated ?? []) {
    rows.push({
      key: `identity-${entry.identityId}`,
      displayName: entry.displayName,
      seatLabel: 'Unseated',
      roleLabel: 'Spectator',
    });
  }
  return rows.sort(
    (a, b) => a.displayName.localeCompare(b.displayName) || a.seatLabel.localeCompare(b.seatLabel),
  );
}

/** M1-11: connected identities without a seat, as dropdown options for `seat.assign`. */
export function rosterOptions(
  unseated: readonly { identityId: string; displayName: string }[] | undefined,
): RosterOption[] {
  return (unseated ?? []).map((u) => ({
    identityId: u.identityId,
    label: `${u.displayName} (${u.identityId.slice(-4)})`,
  }));
}
