import { z } from 'zod';
import { Ulid } from './common.js';

/**
 * UX-44 / UI-JOIN-01: the one thing a visitor may learn before joining. `GET /api/join` returns
 * exactly this, with no credentials and no socket. Every object is strict, so a field that is not
 * listed here cannot be added to the response by accident (PERM-03): no identity ids, tokens,
 * permissions, bindings, spectator count, scene names, entities or other campaign data.
 *
 * Images are content hashes served by the existing public `/assets/<hash>` route, so they keep the
 * upload limits of the image processor.
 */
const ImageHash = z.string().regex(/^[0-9a-f]{64}$/);

/** A short glyph (emoji, initials) or an uploaded image. */
export const JoinIcon = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('glyph'), value: z.string().min(1).max(8) }),
  z.strictObject({ kind: z.literal('image'), hash: ImageHash }),
]);

export const JoinSeat = z.strictObject({
  seatId: Ulid,
  label: z.string().min(1).max(120),
  role: z.enum(['player', 'codm']),
  icon: JoinIcon.optional(),
  /** `claimed` hides who holds it (and whether they are online); archived seats are not listed. */
  claim: z.enum(['free', 'claimed']),
});

export const JoinPayload = z.strictObject({
  protocol: z.number().int().positive(),
  /** The DM's public profile as they entered it when they connected. */
  host: z.strictObject({
    name: z.string().min(1).max(80),
    avatar: z.string().max(32_768).optional(),
  }),
  campaign: z.strictObject({
    title: z.string().max(200),
    icon: JoinIcon.optional(),
    screenshot: ImageHash.optional(),
  }),
  /** False means joining as a player is blocked until the DM activates a scene (UI-TOP-03). */
  sceneActive: z.boolean(),
  /** Permanent seats only. Temporary seats are session-only and never listed. */
  seats: z.array(JoinSeat).max(256),
});
export type JoinPayload = z.infer<typeof JoinPayload>;
