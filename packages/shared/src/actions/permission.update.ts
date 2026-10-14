import { z } from 'zod';
import { EntityPermissions, Id, SeatPermissions } from '../schema/index.js';
import { defineAction } from './define.js';
import { isAdmin, isAdminOn } from './entity-access.js';

const PermissionChanges = SeatPermissions.partial()
  .strict()
  .refine((permissions) => Object.keys(permissions).length > 0, {
    message: 'at least one permission is required',
  });

export const permissionUpdate = defineAction({
  type: 'permission.update',
  schema: z.discriminatedUnion('target', [
    z.strictObject({ target: z.literal('seat'), seatId: Id, permissions: PermissionChanges }),
    z.strictObject({
      target: z.literal('entity'),
      sceneId: Id,
      entityId: Id,
      permissions: EntityPermissions.partial()
        .strict()
        .refine((permissions) => Object.keys(permissions).length > 0, {
          message: 'at least one permission is required',
        }),
    }),
  ]),
  permission: (state, actor, p) => {
    if (!isAdmin(state, actor)) return false;
    if (p.target === 'seat') return p.seatId in state.seats;
    const entity = state.scenes[p.sceneId]?.entities[p.entityId];
    // D32: a co-DM cannot grant itself access to DM-layer entities.
    return entity !== undefined && isAdminOn(state, actor, entity.layer);
  },
  reduce: (draft, a) => {
    const p = a.payload;
    if (p.target === 'seat') {
      const seat = draft.seats[p.seatId];
      if (seat) Object.assign(seat.permissions, p.permissions);
      return;
    }
    const entity = draft.scenes[p.sceneId]?.entities[p.entityId];
    if (entity) entity.perms = { ...entity.perms, ...p.permissions };
  },
  modExposed: false,
});
