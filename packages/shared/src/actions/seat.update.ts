import { z } from 'zod';
import {
  DEFAULT_SEAT_TOOLS,
  Id,
  SEAT_TOOLS,
  SeatIcon,
  SeatTools,
  resolveSeatTools,
} from '../schema/index.js';
import { seatTemplate } from '../seat-templates.js';
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
    if (a.payload.role !== undefined) {
      // UX-46: a demoted Co-DM must not keep the every-tool set it was created with. Tools
      // that are absent or still the Co-DM template's reset to the `DEFAULT_SEAT_TOOLS` fallback;
      // anything else is an explicit override (for example a migrated 0.0.1 value) and is kept.
      if (seat.role === 'codm' && a.payload.role === 'player' && !hasOwnTools(seat.tools))
        seat.tools = { ...DEFAULT_SEAT_TOOLS };
      seat.role = a.payload.role;
    }
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

/**
 * True when a Co-DM seat's tools differ from the Co-DM template's (every board tool on, doors
 * off). A missing key reads as off, so a v11 Co-DM seat without `doors` still matches.
 */
function hasOwnTools(tools: SeatTools | undefined): boolean {
  const template = seatTemplate('codm').tools;
  return (
    tools !== undefined &&
    SEAT_TOOLS.some((tool) => (tools[tool] ?? false) !== (template[tool] ?? false))
  );
}
