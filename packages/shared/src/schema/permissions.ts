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
 * `pins` is the ping permission (the right-click "Ping" marker); the key keeps its 0.0.1 name.
 * TRIG-01 map pins are not a seat tool and must not reuse it.
 */
export const SeatTools = z.strictObject({
  measure: z.boolean(),
  draw: z.boolean(),
  pins: z.boolean(),
  /**
   * MV-303 Q1 (FOG-01, save v12): may this seat open and close ordinary doors (`wall.setDoor`)?
   * Optional so v11 seats load unchanged; absent means off. Never secret doors: those stay
   * admin-only. Co-DMs ignore it (they may always toggle doors).
   */
  doors: z.boolean().optional(),
});
export type SeatTools = z.infer<typeof SeatTools>;
export type SeatTool = keyof SeatTools;
/** A seat's tools with every default filled in (`resolveSeatTools`). */
export type ResolvedSeatTools = Record<SeatTool, boolean>;
export const SEAT_TOOLS: readonly SeatTool[] = ['measure', 'draw', 'pins', 'doors'];

/**
 * The fallback for seats without stored `tools` and for a demoted Co-DM. Measuring is open, drawing
 * and pings are off: the 0.0.1 scene defaults, frozen so a stored or replayed tool-less seat never
 * silently gains a tool. New Player seats start from `PLAYER_TEMPLATE_TOOLS` instead.
 */
export const DEFAULT_SEAT_TOOLS: Readonly<ResolvedSeatTools> = {
  measure: true,
  draw: false,
  pins: false,
  doors: false,
};

/**
 * MV-288: the tools a new Player seat (and a temporary player) starts with. Measure, draw and ping
 * are open; the DM revokes them per seat in the Seats tab. Doors stay off (MV-303 Q1) until the DM
 * grants them per seat.
 */
export const PLAYER_TEMPLATE_TOOLS: Readonly<ResolvedSeatTools> = {
  measure: true,
  draw: true,
  pins: true,
  doors: false,
};

/** A seat's tools with the default filled in. */
export function resolveSeatTools(seat: { tools?: SeatTools | undefined }): ResolvedSeatTools {
  return { ...DEFAULT_SEAT_TOOLS, ...seat.tools, doors: seat.tools?.doors ?? false };
}
