import { z } from 'zod';
import { Id } from '../schema/index.js';
import { defineAction, isHost } from './define.js';

export const seatUpdate = defineAction({
  type: 'seat.update',
  schema: z
    .strictObject({
      seatId: Id,
      label: z.string().trim().min(1).max(120).optional(),
      binding: z.enum(['persistent', 'session']).optional(),
      role: z.enum(['player', 'codm']).optional(),
    })
    .refine((p) => p.label !== undefined || p.binding !== undefined || p.role !== undefined, {
      message: 'at least one field to update is required',
    }),
  permission: (state, actor, p) => isHost(actor) && p.seatId in state.seats,
  reduce: (draft, a) => {
    const seat = draft.seats[a.payload.seatId];
    if (!seat) return;
    if (a.payload.label !== undefined) seat.label = a.payload.label;
    if (a.payload.binding !== undefined) seat.binding = a.payload.binding;
    if (a.payload.role !== undefined) seat.role = a.payload.role;
  },
  modExposed: false,
});
