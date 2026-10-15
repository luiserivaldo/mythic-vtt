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

/**
 * UI-SEAT-02 / PERM-05 (UX-46, MV-251): the board tools a seat may use, set per seat. They replace
 * the 0.0.1 per-scene "players may measure / draw / pin" toggles (save v11); there is no
 * table-wide or scene-wide switch any more. The host and co-DM seats are never limited by them.
 */
export const SeatTools = z.strictObject({
  measure: z.boolean(),
  draw: z.boolean(),
  pins: z.boolean(),
});
export type SeatTools = z.infer<typeof SeatTools>;
export type SeatTool = keyof SeatTools;
export const SEAT_TOOLS: readonly SeatTool[] = ['measure', 'draw', 'pins'];

/**
 * The Player template's tools, and what a seat without stored `tools` gets (session-only temporary
 * seats are created without them). Measuring is open, drawing and pins are opt-in: the same as the
 * 0.0.1 scene defaults, so nothing a player could do before silently changes.
 */
export const DEFAULT_SEAT_TOOLS: Readonly<SeatTools> = { measure: true, draw: false, pins: false };

/** A seat's tools with the default filled in. */
export function resolveSeatTools(seat: { tools?: SeatTools | undefined }): SeatTools {
  return { ...DEFAULT_SEAT_TOOLS, ...seat.tools };
}
