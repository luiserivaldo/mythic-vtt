/**
 * Pure grid line generation (GRID-01). World unit = 1 cell, so lines sit on integer
 * X and Z. No DOM or Three.js, so it is unit-testable.
 */
import type { View2D, Viewport } from './camera-2d.js';

export interface CellRange {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** Hard cap on lines per axis so extreme zoom-out can never allocate a huge buffer. */
export const MAX_LINES_PER_AXIS = 400;
/** Extra cells beyond the viewport so small pans do not rebuild the geometry. */
export const EXTENT_MARGIN_CELLS = 2;
/** Below this many pixels per cell the grid is skipped: it would be a solid smear. */
export const MIN_CELL_PX = 4;

/** Integer line range covering the visible world rectangle plus a margin. */
export function visibleCellRange(view: View2D, viewport: Viewport): CellRange {
  const halfW = viewport.width / 2 / view.zoom;
  const halfH = viewport.height / 2 / view.zoom;
  return {
    minX: Math.floor(view.centerX - halfW) - EXTENT_MARGIN_CELLS,
    maxX: Math.ceil(view.centerX + halfW) + EXTENT_MARGIN_CELLS,
    minZ: Math.floor(view.centerZ - halfH) - EXTENT_MARGIN_CELLS,
    maxZ: Math.ceil(view.centerZ + halfH) + EXTENT_MARGIN_CELLS,
  };
}

export function sameRange(a: CellRange | null, b: CellRange): boolean {
  return (
    a !== null && a.minX === b.minX && a.maxX === b.maxX && a.minZ === b.minZ && a.maxZ === b.maxZ
  );
}

/** Whether the grid is worth drawing at this zoom (pixels per cell). */
export function gridVisible(zoom: number): boolean {
  return Number.isFinite(zoom) && zoom >= MIN_CELL_PX;
}

/**
 * Flat [x1,y,z1,x2,y,z2,...] segment positions for the range: one segment per integer
 * X line and per integer Z line, drawn as a single LineSegments buffer. Empty when
 * either axis would exceed MAX_LINES_PER_AXIS.
 */
export function gridSegments(range: CellRange, y = 0): Float32Array {
  const nx = range.maxX - range.minX + 1;
  const nz = range.maxZ - range.minZ + 1;
  if (nx < 1 || nz < 1 || nx > MAX_LINES_PER_AXIS || nz > MAX_LINES_PER_AXIS) {
    return new Float32Array(0);
  }
  const out = new Float32Array((nx + nz) * 6);
  let i = 0;
  for (let x = range.minX; x <= range.maxX; x++) {
    out.set([x, y, range.minZ, x, y, range.maxZ], i);
    i += 6;
  }
  for (let z = range.minZ; z <= range.maxZ; z++) {
    out.set([range.minX, y, z, range.maxX, y, z], i);
    i += 6;
  }
  return out;
}
