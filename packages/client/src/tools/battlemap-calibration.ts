// ENV-01: pure maths for placing and calibrating a battlemap image. No DOM, no Three.js.
//
// Convention (proposed, see report): a map image is a plane on the XZ plane whose height is
// `scale` cells and whose width is `scale * aspect` cells, centred on `transform.position`,
// with identity rotation. "Local" image coordinates are in image-heights: (0, 0) is the centre,
// x grows with world +X, z grows with world +Z, and the image spans z in [-0.5, 0.5]. Local
// coordinates do not depend on the entity's current position or scale, so picked points stay valid
// while the transform changes.

export interface Local2 {
  x: number;
  z: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Below this many image-heights apart the two points are treated as the same point. */
export const MIN_POINT_SEPARATION = 1e-4;

/** Pixels per cell assumed when an image is first placed, before calibration (matches common VTT defaults). */
export const DEFAULT_PX_PER_CELL = 70;

export type CalibrationUnit = 'scene' | 'cells';

export type CalibrationError = 'identical-points' | 'invalid-distance' | 'invalid-grid';

export type CalibrationResult =
  | { ok: true; scale: number; position: Vec3; cells: number }
  | { ok: false; error: CalibrationError };

export interface CalibrationInput {
  a: Local2;
  b: Local2;
  /** Real distance between the points, in scene units (`unit: 'scene'`) or in grid cells. */
  distance: number;
  unit: CalibrationUnit;
  unitsPerCell: number;
  current: { position: Vec3; scale: number };
  /** `snap`: move the image so the first point lands on the nearest grid intersection. */
  anchor: 'keep' | 'snap';
}

const finite = (n: number) => Number.isFinite(n);

export function localDistance(a: Local2, b: Local2): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

/** Distance in scene units to cells (every displayed distance goes through `unitsPerCell`). */
export function toCells(distance: number, unit: CalibrationUnit, unitsPerCell: number): number {
  return unit === 'cells' ? distance : distance / unitsPerCell;
}

export function localToWorld(p: Local2, position: Vec3, scale: number): { x: number; z: number } {
  return { x: position.x + p.x * scale, z: position.z + p.z * scale };
}

export function worldToLocal(p: { x: number; z: number }, position: Vec3, scale: number): Local2 {
  return { x: (p.x - position.x) / scale, z: (p.z - position.z) / scale };
}

/**
 * Two points the user says are `distance` apart fix the uniform scale. By default the image
 * grows or shrinks about the first point (it stays put under the cursor); with `anchor: 'snap'`
 * that point is then moved to the nearest grid intersection so image and grid line up.
 */
export function solveCalibration(input: CalibrationInput): CalibrationResult {
  const { a, b, distance, unit, unitsPerCell, current, anchor } = input;
  if (![a.x, a.z, b.x, b.z, current.scale, current.position.x, current.position.z].every(finite)) {
    return { ok: false, error: 'invalid-grid' };
  }
  if (!finite(unitsPerCell) || unitsPerCell <= 0 || !finite(current.scale) || current.scale <= 0) {
    return { ok: false, error: 'invalid-grid' };
  }
  if (!finite(distance) || distance <= 0) return { ok: false, error: 'invalid-distance' };
  const separation = localDistance(a, b);
  if (separation < MIN_POINT_SEPARATION) return { ok: false, error: 'identical-points' };

  const cells = toCells(distance, unit, unitsPerCell);
  const scale = cells / separation;
  if (!finite(scale) || scale <= 0) return { ok: false, error: 'invalid-distance' };

  const before = localToWorld(a, current.position, current.scale);
  const target = anchor === 'snap' ? { x: Math.round(before.x), z: Math.round(before.z) } : before;
  return {
    ok: true,
    scale,
    cells,
    position: {
      x: target.x - a.x * scale,
      y: current.position.y,
      z: target.z - a.z * scale,
    },
  };
}

/** Initial scale (cells tall) for a freshly uploaded image of the given pixel size. */
export function defaultPlacementScale(heightPx: number, pxPerCell = DEFAULT_PX_PER_CELL): number {
  return heightPx / pxPerCell;
}

/** Pixels of the source image per grid cell at a given scale, for display. */
export function pixelsPerCell(heightPx: number, scale: number): number {
  return heightPx / scale;
}
