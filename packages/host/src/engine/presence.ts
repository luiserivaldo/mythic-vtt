import type { ServerMessage } from '@mythic/protocol';
import type { Campaign } from '@mythic/shared';
import { seatIdOf } from './audience.js';

type PresenceMessage = Extract<ServerMessage, { t: 'presence' }>;

/** The slice of a live connection that presence needs. */
export interface PresenceConn {
  readonly identityId: string;
  readonly displayName: string;
  readonly color?: string | undefined;
  readonly avatar: string | undefined;
  readonly isHost: boolean;
  readonly latencyMs?: number | null;
  /** UX-44: a watch-link or "Join As Spectator" connection: counted, never listed. */
  readonly spectating?: boolean;
}

/**
 * SES-07 + M1-11: who is connected, per seat, plus the connected identities with no seat so the DM
 * can seat them. `spectators` (UX-44) counts spectator connections and lists none of them. The result carries identity ids, so the engine sends it to the host only (PERM-03).
 */
export function buildHostPresence(state: Campaign, conns: Iterable<PresenceConn>): PresenceMessage {
  const byIdentity = new Map<string, PresenceConn>();
  for (const c of conns) {
    const first = byIdentity.get(c.identityId);
    // A non-spectating connection of an identity represents it (it may hold a seat).
    if (!first || (first.spectating === true && c.spectating !== true))
      byIdentity.set(c.identityId, c);
  }

  const seats: PresenceMessage['seats'] = Object.values(state.seats)
    .filter((seat) => !seat.archived)
    .map((seat) => {
      const live = seat.identityId === null ? undefined : byIdentity.get(seat.identityId);
      return {
        seatId: seat.id,
        ...(live ? { displayName: live.displayName } : {}),
        connected: live !== undefined,
        ...(live?.color !== undefined ? { color: live.color } : {}),
        latencyMs: live?.latencyMs ?? null,
      };
    });

  const unseated: NonNullable<PresenceMessage['unseated']> = [];
  let spectators = 0;
  for (const c of byIdentity.values()) {
    if (c.isHost || seatIdOf(state, c.identityId) !== undefined) continue;
    if (c.spectating === true) {
      // UX-44: spectators carry no visual credentials; only their number reaches the DM.
      spectators += 1;
      continue;
    }
    unseated.push({
      identityId: c.identityId,
      displayName: c.displayName,
      ...(c.color !== undefined ? { color: c.color } : {}),
      ...(c.avatar !== undefined ? { avatar: c.avatar } : {}),
    });
  }
  unseated.sort(
    (a, b) =>
      a.displayName.localeCompare(b.displayName) || a.identityId.localeCompare(b.identityId),
  );
  return { t: 'presence', seats, spectators, unseated };
}
