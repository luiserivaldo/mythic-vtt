import { z } from 'zod';

// LAY-05 / M4-14: the `ping` channel's payload contract. Unlike the ruler and drag-preview channels
// the protocol has no schema for it, and both ends have to enforce the shape: a client validating
// the marker it received, and the host relay validating what a sender put on a scene-toggle-gated
// channel before fanning the frame out to the table. So it lives here rather than in the client
// that draws it. A ping is never campaign state, an action or part of a save (TECHNICAL.md §4.3).

/** The scene id is a ULID; the bound keeps a junk payload from carrying a paragraph of one. */
export const PING_SCENE_ID_MAX = 64;

/**
 * `color` is the sender's validated profile colour, stamped by the relay (UI-JOIN-01), never a
 * colour a sender chose for itself.
 */
export const PingPayload = z.strictObject({
  sceneId: z.string().min(1).max(PING_SCENE_ID_MAX),
  // `z.number()` rejects NaN and ±Infinity, so no marker is ever drawn at a non-finite point.
  x: z.number(),
  y: z.number(),
  z: z.number(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});
export type PingPayload = z.infer<typeof PingPayload>;

/** The payload, or null when the frame is not a ping at all. */
export function parsePingPayload(data: unknown): PingPayload | null {
  const parsed = PingPayload.safeParse(data);
  return parsed.success ? parsed.data : null;
}
