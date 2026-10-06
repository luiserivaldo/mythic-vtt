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
  permissions: Record<PermissionKey, boolean>;
}

export function seatRows(
  campaign: Campaign,
  presence: readonly { seatId: string; connected: boolean }[] | null,
): SeatRow[] {
  const online = new Set((presence ?? []).filter((p) => p.connected).map((p) => p.seatId));
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
