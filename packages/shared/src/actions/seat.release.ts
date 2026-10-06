import { z } from 'zod';
import { Id } from '../schema/index.js';
import { defineAction, isHost } from './define.js';

export const seatRelease = defineAction({
  type: 'seat.release',
  schema: z.strictObject({ seatId: Id }),
  permission: (state, actor, p) => {
    const seat = state.seats[p.seatId];
    if (!seat || seat.identityId === null) return false;
    return isHost(actor) || (actor.kind === 'seat' && actor.seatId === p.seatId);
  },
  reduce: (draft, a) => {
    const seat = draft.seats[a.payload.seatId];
    if (seat) seat.identityId = null;
  },
  modExposed: false,
});
