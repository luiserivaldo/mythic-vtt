import { z } from 'zod';
import { Id } from '../schema/index.js';
import { defineAction, isHost } from './define.js';

const DEFAULT_PERMISSIONS = { view: true, move: true, edit: false, delete: false } as const;

export const seatCreate = defineAction({
  type: 'seat.create',
  schema: z.strictObject({
    seatId: Id,
    label: z.string().trim().min(1).max(120),
    binding: z.enum(['persistent', 'session']).optional(),
    role: z.enum(['player', 'codm']).optional(),
  }),
  permission: (state, actor, p) => isHost(actor) && !(p.seatId in state.seats),
  reduce: (draft, a) => {
    draft.seats[a.payload.seatId] = {
      id: a.payload.seatId,
      label: a.payload.label,
      binding: a.payload.binding ?? draft.settings.defaultBinding,
      identityId: null,
      role: a.payload.role ?? 'player',
      permissions: DEFAULT_PERMISSIONS,
    };
  },
  modExposed: false,
});
