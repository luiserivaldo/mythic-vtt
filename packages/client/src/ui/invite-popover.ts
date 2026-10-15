import type { Campaign } from '@mythic/shared';
import type { ViewerRole } from './viewer.js';

/**
 * UI-TOP-07: DM only. The seat-invite routes are host-only (SES-04), so a co-DM, player or
 * spectator never gets the button, the popover, or a seat list to copy from. This follows the
 * previewed role, so "View as" a player hides it like the rest of the DM chrome.
 */
export const canInvite = (role: ViewerRole): boolean => role === 'host';

/** HOST-01: the guide ships with the released code, so it links to the default branch. */
export const INTERNET_PLAY_GUIDE_URL =
  'https://github.com/luiserivaldo/mythic-vtt/blob/main/docs/internet-play.md';

export interface InviteSeat {
  id: string;
  label: string;
}

/** UI-SEAT-04: every live (unarchived) seat, in the seat panel's order, so either place matches. */
export function inviteSeats(campaign: Campaign | null): InviteSeat[] {
  if (!campaign) return [];
  return Object.values(campaign.seats)
    .filter((seat) => !seat.archived)
    .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
    .map((seat) => ({ id: seat.id, label: seat.label }));
}
