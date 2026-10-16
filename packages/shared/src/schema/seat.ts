import { z } from 'zod';
import { Id } from './ids.js';
import { SeatPermissions, SeatTools } from './permissions.js';

/** UX-44: content-addressed image (same sha256 key as `/assets/:hash` and the image limits). */
export const ImageHash = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'expected a lowercase SHA-256 hex digest');

/** UX-44: a short glyph (emoji/initials) or an uploaded image; no inline data URLs in saves. */
export const SeatIcon = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('glyph'), value: z.string().trim().min(1).max(8) }),
  z.strictObject({ kind: z.literal('image'), hash: ImageHash }),
]);
export type SeatIcon = z.infer<typeof SeatIcon>;

export const Seat = z.object({
  id: Id,
  label: z.string(),
  binding: z.enum(['persistent', 'session']),
  identityId: Id.nullable(),
  role: z.enum(['player', 'codm']),
  permissions: SeatPermissions,
  /**
   * UI-SEAT-02 (UX-46, save v11): the board tools this seat may use; absent means the fallback
   * `DEFAULT_SEAT_TOOLS` (measure only). Ignored for co-DM seats, which may use every tool.
   */
  tools: SeatTools.optional(),
  interactionEnabled: z.boolean().optional(),
  /** SES-03/05: retained for history; archived seats have no access or ownership. */
  archived: z.boolean().optional(),
  /** UI-SEAT-01 (UX-44): the DM-chosen icon of a permanent campaign member. */
  icon: SeatIcon.optional(),
  /**
   * UI-JOIN-01 (UX-44): a session-only seat made by "Join As Temporary Player". It is never
   * written to disk; the host drops it (and its ownership) at session end and on load.
   */
  temporary: z.boolean().optional(),
});
export type Seat = z.infer<typeof Seat>;
