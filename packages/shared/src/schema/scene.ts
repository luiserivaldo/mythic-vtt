import { z } from 'zod';
import { AssetRef } from './asset.js';
import { Entity } from './entity.js';
import { Id, LayerId } from './ids.js';

/** GRID-01: `#rrggbb` only, so every renderer parses it the same way. */
export const GridColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** Defaults applied at read time, so saves written before colour/opacity existed stay valid. */
export const DEFAULT_GRID_COLOR = '#ffffff';
export const DEFAULT_GRID_OPACITY = 0.25;

export const Grid = z.object({
  type: z.enum(['square', 'hex']),
  sizePx: z.number().positive(),
  unitsPerCell: z.number().positive(),
  unitLabel: z.string(),
  diagonal: z.enum(['chebyshev', 'alternating', 'euclidean', 'manhattan']),
  snap: z.boolean(),
  // GRID-01: optional additive fields (no schemaVersion bump); read through resolveGridStyle().
  color: GridColor.optional(),
  opacity: z.number().min(0).max(1).optional(),
});
export type Grid = z.infer<typeof Grid>;

export const Scene = z.object({
  id: Id,
  name: z.string(),
  grid: Grid,
  environment: z.object({ background: z.string(), skybox: AssetRef.optional() }),
  layers: z.partialRecord(LayerId, z.object({ locked: z.boolean() })),
  entities: z.record(Id, Entity),
});
export type Scene = z.infer<typeof Scene>;

export interface GridStyle {
  color: string;
  opacity: number;
}

/** Colour and opacity with defaults filled in for grids that predate GRID-01 styling. */
export function resolveGridStyle(grid: Pick<Grid, 'color' | 'opacity'>): GridStyle {
  return {
    color: grid.color ?? DEFAULT_GRID_COLOR,
    opacity: grid.opacity ?? DEFAULT_GRID_OPACITY,
  };
}
