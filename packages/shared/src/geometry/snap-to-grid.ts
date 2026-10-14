import type { Grid, Vec3 } from '../schema/index.js';

export interface SnapToGridOptions {
  footprint?: number;
}

export class UnsupportedGridError extends Error {
  readonly gridType: Grid['type'];

  constructor(gridType: Grid['type']) {
    super(`Grid type "${gridType}" is not supported by snapToGrid`);
    this.name = 'UnsupportedGridError';
    this.gridType = gridType;
  }
}

export const snapToGrid = (position: Vec3, grid: Grid, options: SnapToGridOptions = {}): Vec3 => {
  if (!grid.snap) return position;
  if (grid.type !== 'square') throw new UnsupportedGridError(grid.type);

  const footprint = options.footprint ?? 1;
  const snapAxis = footprint % 2 === 0 ? Math.round : (value: number) => Math.floor(value) + 0.5;

  return {
    x: snapAxis(position.x),
    y: position.y,
    z: snapAxis(position.z),
  };
};
