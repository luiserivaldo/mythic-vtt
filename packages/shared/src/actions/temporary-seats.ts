import { produce, type Draft } from 'immer';
import type { Campaign } from '../schema/index.js';

/** Abuse bound: a join link is open to anyone who can reach the host. */
export const MAX_TEMPORARY_SEATS = 16;

/** Removes one temporary seat and every ownership reference to it; tokens themselves stay. */
export function removeTemporarySeat(draft: Draft<Campaign>, seatId: string): void {
  Reflect.deleteProperty(draft.seats, seatId);
  for (const scene of Object.values(draft.scenes))
    for (const entity of Object.values(scene.entities))
      if (entity.owners.includes(seatId)) entity.owners = entity.owners.filter((o) => o !== seatId);
  for (const prefab of Object.values(draft.prefabs ?? {}))
    if (prefab.entity.owners?.includes(seatId))
      prefab.entity.owners = prefab.entity.owners.filter((o) => o !== seatId);
}

/**
 * UX-44 / UI-JOIN-01: a temporary seat is session-only. Everything that writes campaign state to
 * disk, and everything that loads it back (crash recovery), passes through this so the saved file
 * never holds a temporary seat or an owner reference to one. Returns the same object when there is
 * nothing to drop.
 */
export function withoutTemporarySeats(state: Campaign): Campaign {
  const temporary = Object.values(state.seats).filter((seat) => seat.temporary === true);
  if (temporary.length === 0) return state;
  return produce(state, (draft) => {
    for (const seat of temporary) removeTemporarySeat(draft, seat.id);
  });
}
