import { z } from 'zod';
import { Id, SeatIcon } from '../schema/index.js';
import { defineAction, isHost } from './define.js';

export const seatUpdate = defineAction({
  type: 'seat.update',
  schema: z
    .strictObject({
      seatId: Id,
      label: z.string().trim().min(1).max(120).optional(),
      binding: z.enum(['persistent', 'session']).optional(),
      role: z.enum(['player', 'codm']).optional(),
      interactionEnabled: z.boolean().optional(),
      /** UX-44: `null` removes the icon. */
      icon: SeatIcon.nullable().optional(),
    })
    .refine(
      (p) =>
        p.label !== undefined ||
        p.binding !== undefined ||
        p.role !== undefined ||
        p.interactionEnabled !== undefined ||
        p.icon !== undefined,
      {
        message: 'at least one field to update is required',
      },
    ),
  permission: (state, actor, p) => isHost(actor) && p.seatId in state.seats,
  reduce: (draft, a) => {
    const seat = draft.seats[a.payload.seatId];
    if (!seat) return;
    if (a.payload.label !== undefined) seat.label = a.payload.label;
    if (a.payload.binding !== undefined) seat.binding = a.payload.binding;
    if (a.payload.role !== undefined) seat.role = a.payload.role;
    if (a.payload.interactionEnabled !== undefined)
      seat.interactionEnabled = a.payload.interactionEnabled;
    if (a.payload.icon === null) delete seat.icon;
    else if (a.payload.icon !== undefined) seat.icon = a.payload.icon;
  },
  modExposed: false,
});
