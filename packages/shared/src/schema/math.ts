import { z } from 'zod';

// Coordinates follow TECHNICAL.md §6.2: Y-up, 1 world unit = 1 grid cell.
// Objects (not tuples) keep patches readable: `/position/y` is elevation.
export const Vec3 = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});
export type Vec3 = z.infer<typeof Vec3>;

export const Quat = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
  w: z.number(),
});
export type Quat = z.infer<typeof Quat>;

export const Transform = z.object({ position: Vec3, rotation: Quat, scale: Vec3 });
export type Transform = z.infer<typeof Transform>;
