/**
 * Grid extent for the 3D perspective camera (M2-05, keeps GRID-01 visible in both views).
 * Pure: the orthographic path in grid-lines.ts derives its range from pixels per cell, which
 * has no meaning for a perspective camera, so this derives it from where the camera looks.
 */
import {
  visibleCellRange,
  MAX_LINES_PER_AXIS,
  EXTENT_MARGIN_CELLS,
  type CellRange,
} from './grid-lines.js';

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Largest half-extent that still fits MAX_LINES_PER_AXIS lines (plus margin and rounding). */
export const MAX_HALF_EXTENT = Math.floor((MAX_LINES_PER_AXIS - 2 * EXTENT_MARGIN_CELLS - 2) / 2);
/** Visible ground reaches roughly this many camera-to-focus distances from the focus. */
const REACH = 2;

/**
 * Square of cells around the ground point the camera looks at, sized from the camera distance
 * so the foreshortened far side of a tilted view is still covered (up to the line cap).
 */
export function perspectiveGridRange(position: Vec3, direction: Vec3): CellRange {
  let fx = position.x;
  let fz = position.z;
  let distance = Math.abs(position.y);
  if (direction.y < -1e-6 && position.y > 0) {
    const t = position.y / -direction.y;
    fx = position.x + direction.x * t;
    fz = position.z + direction.z * t;
    distance = t;
  }
  const half = Math.min(MAX_HALF_EXTENT, Math.max(8, Math.ceil(distance * REACH)));
  return visibleCellRange(
    { centerX: fx, centerZ: fz, zoom: 1 },
    { width: half * 2, height: half * 2 },
  );
}

/** Longest single line segment in the 3D grid (cells). */
export const CHUNK_CELLS = 16;

/**
 * Like gridSegments, but every line is cut into short pieces. A perspective camera looks along
 * lines that pass behind it, and very long segments crossing the near plane get clipped
 * unreliably by some GL implementations (lines vanish); short pieces keep that error small.
 */
export function gridSegmentsChunked(range: CellRange, y = 0, chunk = CHUNK_CELLS): Float32Array {
  const nx = range.maxX - range.minX + 1;
  const nz = range.maxZ - range.minZ + 1;
  if (nx < 1 || nz < 1 || nx > MAX_LINES_PER_AXIS || nz > MAX_LINES_PER_AXIS) {
    return new Float32Array(0);
  }
  const spanX = range.maxX - range.minX;
  const spanZ = range.maxZ - range.minZ;
  const piecesZ = Math.max(1, Math.ceil(spanZ / chunk));
  const piecesX = Math.max(1, Math.ceil(spanX / chunk));
  const out = new Float32Array((nx * piecesZ + nz * piecesX) * 6);
  let i = 0;
  for (let x = range.minX; x <= range.maxX; x++) {
    for (let p = 0; p < piecesZ; p++) {
      const z0 = range.minZ + Math.round((spanZ * p) / piecesZ);
      const z1 = range.minZ + Math.round((spanZ * (p + 1)) / piecesZ);
      out.set([x, y, z0, x, y, z1], i);
      i += 6;
    }
  }
  for (let z = range.minZ; z <= range.maxZ; z++) {
    for (let p = 0; p < piecesX; p++) {
      const x0 = range.minX + Math.round((spanX * p) / piecesX);
      const x1 = range.minX + Math.round((spanX * (p + 1)) / piecesX);
      out.set([x0, y, z, x1, y, z], i);
      i += 6;
    }
  }
  return out;
}
