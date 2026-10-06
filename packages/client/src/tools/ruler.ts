import {
  distance,
  resolveSceneBounds,
  snapToGrid,
  toSceneUnits,
  UnsupportedGridError,
  type Grid,
  type Scene,
  type Vec3,
} from '@mythic/shared';

export interface RulerSegment {
  readonly from: Vec3;
  readonly to: Vec3;
  readonly midpoint: Vec3;
  readonly cells: number;
  readonly label: string;
}

export interface RulerMeasurement {
  readonly segments: readonly RulerSegment[];
  readonly totalCells: number;
  readonly totalLabel: string;
}

function trim(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** MEAS-01: every ruler readout is converted from cells through the active scene's units. */
export function formatRulerDistance(cells: number, grid: Pick<Grid, 'unitsPerCell' | 'unitLabel'>) {
  const value = trim(toSceneUnits(cells, grid));
  const unit = grid.unitLabel.trim();
  return unit ? `${value} ${unit}` : value;
}

/** Segment distances are measured independently, then summed for a multi-waypoint total. */
export function measureRuler(points: readonly Vec3[], grid: Grid): RulerMeasurement {
  const segments: RulerSegment[] = [];
  let totalCells = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    if (!from || !to) continue;
    const cells = distance(from, to, grid.diagonal).total;
    totalCells += cells;
    segments.push({
      from,
      to,
      midpoint: { x: (from.x + to.x) / 2, y: 0, z: (from.z + to.z) / 2 },
      cells,
      label: formatRulerDistance(cells, grid),
    });
  }
  return { segments, totalCells, totalLabel: formatRulerDistance(totalCells, grid) };
}

/** Ground-plane point, snapped when the shared grid implementation supports that grid type. */
export function prepareRulerPoint(raw: Pick<Vec3, 'x' | 'z'>, scene: Scene): Vec3 {
  let point: Vec3 = { x: raw.x, y: 0, z: raw.z };
  try {
    point = snapToGrid(point, scene.grid);
  } catch (error) {
    // Hex snapping is not implemented by the shared geometry contract yet; measurement still works.
    if (!(error instanceof UnsupportedGridError)) throw error;
  }
  const bounds = resolveSceneBounds(scene);
  return {
    x: Math.max(0, Math.min(bounds.width, point.x)),
    y: 0,
    z: Math.max(0, Math.min(bounds.height, point.z)),
  };
}

export function sameRulerPoint(a: Vec3 | undefined, b: Vec3): boolean {
  return a?.x === b.x && a.y === b.y && a.z === b.z;
}

