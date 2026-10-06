import type { SceneBounds } from '../schema/index.js';

/** D37: origin top-left, x in [0, width], z in [0, height]; edges are inside. Y is not bounded. */
export const isWithinBounds = (bounds: SceneBounds, pos: { x: number; z: number }): boolean =>
  Number.isFinite(pos.x) &&
  Number.isFinite(pos.z) &&
  pos.x >= 0 &&
  pos.x <= bounds.width &&
  pos.z >= 0 &&
  pos.z <= bounds.height;

/** Nearest in-bounds position; y and any other fields are preserved. */
export const clampToBounds = <T extends { x: number; z: number }>(
  bounds: SceneBounds,
  pos: T,
): T => ({
  ...pos,
  x: Math.min(Math.max(pos.x, 0), bounds.width),
  z: Math.min(Math.max(pos.z, 0), bounds.height),
});
