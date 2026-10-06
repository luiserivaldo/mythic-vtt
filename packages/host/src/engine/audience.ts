import { audienceKey, type Actor, type Audience, type Campaign } from '@mythic/shared';

/** What the engine needs to know about a connection to place it. */
export interface Participant {
  readonly identityId: string;
  /** D24: the bound host identity (admin privileges). */
  readonly isHost: boolean;
}

/** The seat this identity currently occupies (SES-03: at most one), if any. */
export function seatIdOf(state: Campaign, identityId: string): string | undefined {
  for (const seat of Object.values(state.seats)) if (seat.identityId === identityId) return seat.id;
  return undefined;
}

/**
 * Who this participant may *see* (PERM-03). Host -> unfiltered; seated -> that seat; everyone
 * else (not yet seated, or spectating) -> the shared spectator audience (§7.4). D32: a co-DM seat
 * is a seat audience too; `visibleTo` reads the seat's role to include the DM layer, so
 * `audienceViewKey` below carries the role to force a fresh snapshot when it changes.
 */
export function audienceFor(state: Campaign, p: Participant): Audience {
  if (p.isHost) return { kind: 'host' };
  const seatId = seatIdOf(state, p.identityId);
  return seatId === undefined ? { kind: 'spectators' } : { kind: 'seat', seatId };
}

/**
 * Who this participant *acts as* (§4.1). An unseated identity is a `seat` actor without a
 * `seatId`: shared permission rules deny it everything (`seatOf` resolves to undefined) except
 * claiming a free seat for its own identity via `session.join`.
 */
export function actorFor(state: Campaign, p: Participant): Actor {
  if (p.isHost) return { kind: 'host', identityId: p.identityId };
  const seatId = seatIdOf(state, p.identityId);
  return seatId === undefined
    ? { kind: 'seat', identityId: p.identityId }
    : { kind: 'seat', seatId, identityId: p.identityId };
}

/**
 * Identity of the *view* a participant gets: the audience plus, for seats, the role that decides
 * DM-layer visibility (D32). Differs from `audienceKey` so promoting or demoting a seat counts as
 * an audience change (fresh snapshot, no stale replay).
 */
export function audienceViewKey(state: Campaign, p: Participant): string {
  const audience = audienceFor(state, p);
  if (audience.kind !== 'seat') return audienceKey(audience);
  return `${audienceKey(audience)}:${state.seats[audience.seatId]?.role ?? 'player'}`;
}
