import type { ServerMessage } from '@mythic/protocol';
import type { Campaign } from '@mythic/shared';
import { seatIdOf } from './audience.js';

type PresenceMessage = Extract<ServerMessage, { t: 'presence' }>;

/** The slice of a live connection that presence needs. */
export interface PresenceConn {
  readonly identityId: string;
  readonly displayName: string;
  readonly avatar: string | undefined;
  readonly isHost: boolean;
}

/**
 * SES-07 + M1-11: who is connected, per seat, plus the connected identities with no seat so the DM
 * can seat them. The result carries identity ids, so the engine sends it to the host only (PERM-03).
 */
export function buildHostPresence(state: Campaign, conns: Iterable<PresenceConn>): PresenceMessage {
  const byIdentity = new Map<string, PresenceConn>();
  for (const c of conns) if (!byIdentity.has(c.identityId)) byIdentity.set(c.identityId, c);

  const seats: PresenceMessage['seats'] = Object.values(state.seats).map((seat) => {
    const live = seat.identityId === null ? undefined : byIdentity.get(seat.identityId);
    return {
      seatId: seat.id,
      ...(live ? { displayName: live.displayName } : {}),
      connected: live !== undefined,
    };
  });

  const unseated: NonNullable<PresenceMessage['unseated']> = [];
  for (const c of byIdentity.values()) {
    if (c.isHost || seatIdOf(state, c.identityId) !== undefined) continue;
    unseated.push({
      identityId: c.identityId,
      displayName: c.displayName,
      ...(c.avatar !== undefined ? { avatar: c.avatar } : {}),
    });
  }
  unseated.sort(
    (a, b) =>
      a.displayName.localeCompare(b.displayName) || a.identityId.localeCompare(b.identityId),
  );
  return { t: 'presence', seats, spectators: unseated.length, unseated };
}
