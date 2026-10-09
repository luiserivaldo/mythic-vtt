import { z } from 'zod';

// ENV-08: bounded, translucent washes preserve the underlying board information.
export const SceneOverlay = z.strictObject({
  tint: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  tintOpacity: z.number().min(0).max(0.35),
  darkness: z.number().min(0).max(0.5),
});
export type SceneOverlay = z.infer<typeof SceneOverlay>;
