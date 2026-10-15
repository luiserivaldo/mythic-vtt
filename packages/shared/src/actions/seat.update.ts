import { z } from 'zod';
import { Id, SEAT_TOOLS, SeatIcon, SeatTools, resolveSeatTools } from '../schema/index.js';
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
      /** UI-SEAT-02 (UX-46): a per-seat override of one or more board tools. */
      tools: SeatTools.partial()
        .refine((t) => Object.keys(t).length > 0, { message: 'at least one tool is required' })
        .optional(),
    })
    .refine(
      (p) =>
        p.label !== undefined ||
        p.binding !== undefined ||
        p.role !== undefined ||
        p.interactionEnabled !== undefined ||
        p.icon !== undefined ||
        p.tools !== undefined,
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
    // The override is stored whole, so the seat no longer depends on the template default.
    const override = a.payload.tools;
    if (override !== undefined) {
      const tools = resolveSeatTools(seat);
      for (const tool of SEAT_TOOLS) tools[tool] = override[tool] ?? tools[tool];
      seat.tools = tools;
    }
  },
  modExposed: false,
});
