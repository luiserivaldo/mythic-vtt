import { SceneOverlay } from './scene-overlay.js';
import { z } from 'zod';
import { AssetRef } from './asset.js';
import { Entity } from './entity.js';
import { Id, LayerId } from './ids.js';

/** GRID-01: `#rrggbb` only, so every renderer parses it the same way. */
export const GridColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** Defaults applied at read time, so saves written before colour/opacity existed stay valid. */
export const DEFAULT_GRID_COLOR = '#1e293b';
export const DEFAULT_GRID_OPACITY = 0.6;
export const DEFAULT_SCENE_BACKGROUND = '#d9dde3';

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

/** D37: whole grid cells, so the canvas always lines up with the grid. */
export const MAX_SCENE_CELLS = 200;
export const DEFAULT_SCENE_WIDTH = 40;
export const DEFAULT_SCENE_HEIGHT = 30;

const BoundsCells = z.number().int().min(1).max(MAX_SCENE_CELLS);
export const SceneBounds = z.strictObject({ width: BoundsCells, height: BoundsCells });
export type SceneBounds = z.infer<typeof SceneBounds>;

export const Scene = z.object({
  id: Id,
  name: z.string(),
  grid: Grid,
  // D37: optional additive (no schemaVersion bump); read through resolveSceneBounds().
  bounds: SceneBounds.optional(),
  environment: z.object({
    background: z.string(),
    // ENV-07: optional additive (no schemaVersion bump). When set, 3D shows a vertical gradient
    // from `background` (horizon) up to `zenith`; absent means a plain colour.
    zenith: z.string().min(1).max(64).optional(),
    skybox: AssetRef.optional(),
  }),
  layers: z.partialRecord(LayerId, z.object({ locked: z.boolean() })),
  entities: z.record(Id, Entity),
  overlay: SceneOverlay.optional(),
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

/** D37: the scene canvas with the 40 x 30 default for scenes that predate bounds. */
export function resolveSceneBounds(scene: Pick<Scene, 'bounds'>): SceneBounds {
  return scene.bounds ?? { width: DEFAULT_SCENE_WIDTH, height: DEFAULT_SCENE_HEIGHT };
}
