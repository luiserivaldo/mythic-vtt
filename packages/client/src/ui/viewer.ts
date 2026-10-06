import type { Campaign } from '@mythic/shared';

export type ViewerRole = 'host' | 'codm' | 'player' | 'observer';

export interface ViewerInput {
  isHost: boolean;
  seatId: string | null;
  campaign: Campaign | null;
}

/**
 * D24: the host is admin; a seat with role `codm` is admin too. A client with no seat that did
 * not claim host is an observer. This only decides what to *show*; the host re-checks every intent.
 */
export function viewerRole({ isHost, seatId, campaign }: ViewerInput): ViewerRole {
  if (isHost) return 'host';
  const seat = seatId === null ? undefined : campaign?.seats[seatId];
  if (!seat) return 'observer';
  return seat.role === 'codm' ? 'codm' : 'player';
}

/** Scenes, layers and permissions: host or co-DM (matches the shared `isAdmin`). */
export const isAdminRole = (role: ViewerRole): boolean => role === 'host' || role === 'codm';

/** Seat create/assign/update are host-only in the shared actions. */
export const canManageSeats = (role: ViewerRole): boolean => role === 'host';
