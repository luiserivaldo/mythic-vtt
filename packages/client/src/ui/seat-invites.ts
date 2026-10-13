import { SeatInviteIssued, SeatInviteList, SeatInviteRevoked } from '@mythic/protocol';
import { authorizationHeader, type UploadCredential } from '../assets/image-upload.js';
import { loadOrCreateIdentity } from '../net/identity.js';
import { playerVisibleUrl } from './share-panel.js';

/** The slice of `fetch` these calls need, so a test can stand in for the host. */
export type InviteFetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * SES-04: the DM's own identity authorises the host-only seat routes. The host's reply is the only
 * place a token ever appears, and it goes into the link the DM chooses to send and nowhere else.
 */
function dmCredential(): UploadCredential {
  return loadOrCreateIdentity(
    localStorage,
    Date.now(),
    () => crypto.getRandomValues(new Uint8Array(1))[0] ?? 0,
  );
}

const authHeader = (credential: UploadCredential): Record<string, string> => ({
  Authorization: authorizationHeader(credential),
});

/** SES-04: `<seatId>.<token>` rides in the fragment, so it misses request lines, logs and referrers. */
export function seatInviteUrl(playerUrl: string, seatId: string, token: string): string {
  const url = new URL(playerVisibleUrl(playerUrl));
  url.hash = new URLSearchParams({ invite: `${seatId}.${token}` }).toString();
  return url.toString();
}

/** Regenerating is destructive, so the DM confirms before the current link stops working. */
export function inviteWarning(label: string): string {
  return `Regenerate the invite link for ${label}? The current link stops working.`;
}

export async function listSeatInvites(
  fetchFn: InviteFetch = fetch,
  credential: UploadCredential = dmCredential(),
): Promise<string[]> {
  const response = await fetchFn('/api/seat-invites', {
    headers: authHeader(credential),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Could not read the invite links');
  return SeatInviteList.parse(await response.json()).seatIds;
}

/** Issues a link for an unused seat, and rotates it — the previous token dies — for a used one. */
export async function issueSeatInvite(
  seatId: string,
  fetchFn: InviteFetch = fetch,
  credential: UploadCredential = dmCredential(),
): Promise<string> {
  const response = await fetchFn(`/api/seat-invites/${seatId}`, {
    method: 'POST',
    headers: authHeader(credential),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Could not issue the invite link');
  return SeatInviteIssued.parse(await response.json()).token;
}

export async function revokeSeatInvite(
  seatId: string,
  fetchFn: InviteFetch = fetch,
  credential: UploadCredential = dmCredential(),
): Promise<void> {
  const response = await fetchFn(`/api/seat-invites/${seatId}`, {
    method: 'DELETE',
    headers: authHeader(credential),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Could not revoke the invite link');
  SeatInviteRevoked.parse(await response.json());
}
