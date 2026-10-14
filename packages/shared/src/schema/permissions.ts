import { z } from 'zod';

// PERM-02: view / move / edit / delete, per seat and per entity.
// Shape is chosen here: the design names these types but does not define them.
export const PermissionSet = z.object({
  view: z.boolean(),
  move: z.boolean(),
  edit: z.boolean(),
  delete: z.boolean(),
});
export type PermissionSet = z.infer<typeof PermissionSet>;

export const SeatPermissions = PermissionSet;
export type SeatPermissions = PermissionSet;

export const EntityPermissions = PermissionSet;
export type EntityPermissions = PermissionSet;
