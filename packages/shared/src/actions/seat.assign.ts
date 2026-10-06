import { z } from 'zod';
import { Id } from '../schema/index.js';
import { defineAction, isHost } from './define.js';

function identityHasOtherSeat(
  seats: Readonly<Record<string, { id: string; identityId: string | null }>>,
  seatId: string,
  identityId: string,
): boolean {
  return Object.values(seats).some((seat) => seat.id !== seatId && seat.identityId === identityId);
}

export const seatAssign = defineAction({
  type: 'seat.assign',
  schema: z.strictObject({ seatId: Id, identityId: Id }),
  permission: (state, actor, p) => {
    const seat = state.seats[p.seatId];
    return (
      isHost(actor) &&
      seat !== undefined &&
      (seat.identityId === null || seat.identityId === p.identityId) &&
      !identityHasOtherSeat(state.seats, p.seatId, p.identityId)
    );
  },
  reduce: (draft, a) => {
    const seat = draft.seats[a.payload.seatId];
    if (seat) seat.identityId = a.payload.identityId;
  },
  modExposed: false,
});
