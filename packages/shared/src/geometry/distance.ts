import type { Grid, Vec3 } from '../schema/index.js';

export type DistanceRule = Grid['diagonal'];

export interface DistanceResult {
  horizontal: number;
  vertical: number;
  total: number;
}

interface AxisDeltas {
  x: number;
  y: number;
  z: number;
}

const deltas = (a: Vec3, b: Vec3): AxisDeltas => ({
  x: Math.abs(a.x - b.x),
  y: Math.abs(a.y - b.y),
  z: Math.abs(a.z - b.z),
});

export const chebyshev3d = (a: Vec3, b: Vec3): number => {
  const { x, y, z } = deltas(a, b);
  return Math.max(x, y, z);
};

export const manhattan3d = (a: Vec3, b: Vec3): number => {
  const { x, y, z } = deltas(a, b);
  return x + y + z;
};

export const euclidean3d = (a: Vec3, b: Vec3): number => {
  const { x, y, z } = deltas(a, b);
  return Math.hypot(x, y, z);
};

export const alternating3d = (a: Vec3, b: Vec3): number => {
  const { x, y, z } = deltas(a, b);
  let largest = x;
  let middle = y;
  let smallest = z;

  if (largest < middle) [largest, middle] = [middle, largest];
  if (middle < smallest) [middle, smallest] = [smallest, middle];
  if (largest < middle) [largest, middle] = [middle, largest];

  // GRID-03: each axis after the largest contributes an alternating diagonal cost.
  return largest + Math.floor(middle / 2) + Math.floor(smallest / 2);
};

const horizontalDistance = (x: number, z: number, rule: DistanceRule): number => {
  switch (rule) {
    case 'chebyshev':
      return Math.max(x, z);
    case 'manhattan':
      return x + z;
    case 'euclidean':
      return Math.hypot(x, z);
    case 'alternating':
      return Math.max(x, z) + Math.floor(Math.min(x, z) / 2);
  }
};

export const distance = (a: Vec3, b: Vec3, rule: DistanceRule): DistanceResult => {
  const { x, y, z } = deltas(a, b);
  const horizontal = horizontalDistance(x, z, rule);

  let total: number;
  switch (rule) {
    case 'chebyshev':
      total = chebyshev3d(a, b);
      break;
    case 'manhattan':
      total = manhattan3d(a, b);
      break;
    case 'euclidean':
      total = euclidean3d(a, b);
      break;
    case 'alternating':
      total = alternating3d(a, b);
      break;
  }

  return { horizontal, vertical: y, total };
};

export const toSceneUnits = (cells: number, grid: Pick<Grid, 'unitsPerCell'>): number =>
  cells * grid.unitsPerCell;
