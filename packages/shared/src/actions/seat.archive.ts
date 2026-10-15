import { z } from 'zod';
import { Id } from '../schema/index.js';
import { defineAction, isHost } from './define.js';

export const seatArchive = defineAction({
  type: 'seat.archive',
  schema: z.strictObject({ seatId: Id }),
  permission: (state, actor, p) =>
    isHost(actor) &&
    state.seats[p.seatId] !== undefined &&
    !state.seats[p.seatId]?.archived &&
    // UX-44: a temporary seat is discarded, never archived into the saved file.
    !state.seats[p.seatId]?.temporary,
  reduce: (draft, a) => {
    const seat = draft.seats[a.payload.seatId];
    if (!seat) return;
    seat.archived = true;
    // SES-05: retain login history and character links; hand ownership back without deleting data.
    for (const scene of Object.values(draft.scenes))
      for (const entity of Object.values(scene.entities))
        if (entity.owners.includes(seat.id))
          entity.owners = entity.owners.filter((id) => id !== seat.id);
  },
  modExposed: false,
});
