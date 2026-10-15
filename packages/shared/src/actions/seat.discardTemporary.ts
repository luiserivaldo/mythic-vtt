import { z } from 'zod';
import { Id } from '../schema/index.js';
import { defineAction, isHost } from './define.js';
import { removeTemporarySeat } from './temporary-seats.js';

/** UX-44: ends a temporary seat (session end, or the DM removing it). Tokens keep existing. */
export const seatDiscardTemporary = defineAction({
  type: 'seat.discardTemporary',
  schema: z.strictObject({ seatId: Id }),
  permission: (state, actor, p) => isHost(actor) && state.seats[p.seatId]?.temporary === true,
  reduce: (draft, a) => {
    removeTemporarySeat(draft, a.payload.seatId);
  },
  modExposed: false,
});
