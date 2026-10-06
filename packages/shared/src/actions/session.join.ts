import { z } from 'zod';
import { Id } from '../schema/index.js';
import { defineAction, isHost } from './define.js';

export const sessionJoin = defineAction({
  type: 'session.join',
  schema: z.strictObject({ seatId: Id, identityId: Id }),
  permission: (state, actor, p) => {
    const seat = state.seats[p.seatId];
    if (!seat || (seat.identityId !== null && seat.identityId !== p.identityId)) return false;
    if (
      Object.values(state.seats).some(
        (candidate) => candidate.identityId === p.identityId && candidate.id !== p.seatId,
      )
    ) {
      return false;
    }
    return isHost(actor) || (actor.kind === 'seat' && actor.identityId === p.identityId);
  },
  reduce: (draft, a) => {
    const seat = draft.seats[a.payload.seatId];
    if (seat) seat.identityId = a.payload.identityId;
  },
  modExposed: false,
});
