import type { HistoryLike, LocationLike } from './host-token.js';
import { authorizationHeader, type UploadCredential } from '../assets/image-upload.js';

export interface SeatInvite {
  seatId: string;
  token: string;
}

const INVITE = /^([0-9A-HJKMNP-TV-Z]{26})\.([A-Za-z0-9_-]{43})$/;

/**
 * SES-04: the invite rides in the URL fragment (`#invite=<seatId>.<token>`) so it is never sent
 * in a request line or referrer. Read it once and scrub it from the address bar and history.
 */
export function extractSeatInvite(loc: LocationLike, history: HistoryLike): SeatInvite | undefined {
  const params = new URLSearchParams(loc.hash.replace(/^#/, ''));
  const raw = params.get('invite');
  if (raw === null) return undefined;
  params.delete('invite');
  const rest = params.toString();
  history.replaceState(null, '', `${loc.pathname}${loc.search}${rest ? `#${rest}` : ''}`);
  const match = INVITE.exec(raw);
  return match?.[1] && match[2] ? { seatId: match[1], token: match[2] } : undefined;
}

export type SeatInviteResult = 'seated' | 'invalid' | 'taken' | 'error';

/** POSTs the invite with the identity credential in the header; the token goes in the body only. */
export async function redeemSeatInvite(
  credential: UploadCredential,
  invite: SeatInvite,
  fetchFn: typeof fetch = fetch,
): Promise<SeatInviteResult> {
  try {
    const response = await fetchFn('/api/seat-invites/redeem', {
      method: 'POST',
      headers: {
        Authorization: authorizationHeader(credential),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(invite),
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    if (response.ok) return 'seated';
    if (response.status === 404) return 'invalid';
    if (response.status === 409) return 'taken';
    return 'error';
  } catch {
    return 'error';
  }
}

export function seatInviteMessage(result: SeatInviteResult): string | undefined {
  if (result === 'invalid') return 'This invite link is no longer valid. Ask the DM for a new one.';
  if (result === 'taken') return 'That seat is already taken. Ask the DM to free it.';
  if (result === 'error') return 'The invite could not be redeemed. Check your connection.';
  return undefined;
}
