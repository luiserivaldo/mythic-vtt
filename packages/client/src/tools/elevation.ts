import type { Grid } from '@mythic/shared';

// TOK-03 / D25. Pure elevation maths for the +/- controls, the numeric field and the 2D badge.
// Elevation is stored in cells (`transform.position.y`); everything the user sees is scene units.

export const ELEVATION_LIMIT_CELLS = 1000;
const FREE_STEP_CELLS = 0.1;
const SHIFT_STEP_CELLS = 5;
const EPS = 1e-9;

/** D25: whole grid cells while `grid.snap`, otherwise 0.1 cell; Shift jumps five cells. */
export function elevationStep(grid: Pick<Grid, 'snap'>, shift: boolean): number {
  if (shift) return SHIFT_STEP_CELLS;
  return grid.snap ? 1 : FREE_STEP_CELLS;
}

function clamp(cells: number): number {
  return Math.min(ELEVATION_LIMIT_CELLS, Math.max(-ELEVATION_LIMIT_CELLS, cells));
}

/** Next stop in `direction`; an off-grid height first moves to the neighbouring stop. */
export function nextElevation(
  current: number,
  grid: Pick<Grid, 'snap'>,
  direction: 1 | -1,
  shift: boolean,
): number {
  const step = elevationStep(grid, shift);
  const stops = current / step;
  const next = direction > 0 ? Math.floor(stops + EPS) + 1 : Math.ceil(stops - EPS) - 1;
  // Round away float noise such as 0.30000000000000004.
  return clamp(Math.round(next * step * 1e6) / 1e6);
}

/** Typed value in scene units -> cells, snapped when the grid snaps (D25). Null if out of range. */
export function elevationFromUnits(
  units: number,
  grid: Pick<Grid, 'snap' | 'unitsPerCell'>,
): number | null {
  if (!Number.isFinite(units) || grid.unitsPerCell <= 0) return null;
  const cells = units / grid.unitsPerCell;
  if (Math.abs(cells) > ELEVATION_LIMIT_CELLS) return null;
  return Math.round((grid.snap ? Math.round(cells) : cells) * 1e6) / 1e6;
}

/** Number of scene units for a field, without float noise or trailing zeros. */
export function formatUnits(cells: number, unitsPerCell: number): string {
  const units = Math.round(cells * unitsPerCell * 100) / 100;
  return String(Object.is(units, -0) ? 0 : units);
}

/** '+10 ft' / '-5 ft'; null at ground level so the badge is shown only when elevation != 0. */
export function formatElevation(
  cells: number,
  grid: Pick<Grid, 'unitsPerCell' | 'unitLabel'>,
): string | null {
  const text = formatUnits(cells, grid.unitsPerCell);
  if (Number(text) === 0) return null;
  const label = grid.unitLabel.trim();
  return `${Number(text) > 0 ? '+' : ''}${text}${label ? ` ${label}` : ''}`;
}
