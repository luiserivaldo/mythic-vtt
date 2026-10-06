import { footprintCells } from './token-footprint.js';

// M2-06 / TOK-03: pure maths for the 3D token standee. No Three.js here so it is unit-testable.

/** Standee height as a multiple of the footprint edge, so a Huge token towers over a Medium one. */
export const STANDEE_HEIGHT_PER_CELL = 1.2;
/** The image quad is a little narrower than the footprint so neighbours never visually overlap. */
export const STANDEE_WIDTH_FRACTION = 0.9;
/** Base disc diameter as a fraction of the footprint edge. */
export const BASE_DIAMETER_FRACTION = 0.95;
export const BASE_THICKNESS = 0.06;
/** Gap between the standee top and its HTML label anchor, in world units. */
export const LABEL_GAP = 0.2;

export interface StandeeDims {
  /** Image quad width. */
  width: number;
  /** Image quad height, measured from the top of the base. */
  height: number;
  baseRadius: number;
  baseThickness: number;
}

export function standeeDimensions(sizeCells: number | undefined): StandeeDims {
  const f = footprintCells(sizeCells);
  return {
    width: f * STANDEE_WIDTH_FRACTION,
    height: f * STANDEE_HEIGHT_PER_CELL,
    baseRadius: (f * BASE_DIAMETER_FRACTION) / 2,
    baseThickness: BASE_THICKNESS,
  };
}

/**
 * Y-axis-only billboard: the rotation about world Y that turns a +Z-facing quad toward the camera.
 * Only yaw is used so the standee stays upright and the image is never mirrored (CAM-04).
 * A camera exactly above the token has no meaningful yaw; keep `fallback` (the previous yaw).
 */
export function billboardYaw(
  token: { x: number; z: number },
  camera: { x: number; z: number },
  fallback = 0,
): number {
  const dx = camera.x - token.x;
  const dz = camera.z - token.z;
  if (!Number.isFinite(dx) || !Number.isFinite(dz) || Math.hypot(dx, dz) < 1e-6) return fallback;
  return Math.atan2(dx, dz);
}

/** Label anchor relative to the token position (its feet): above the standee top. */
export function labelAnchor3d(sizeCells: number | undefined): readonly [number, number, number] {
  const { height, baseThickness } = standeeDimensions(sizeCells);
  return [0, baseThickness + height + LABEL_GAP, 0];
}
