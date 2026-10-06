import { z } from 'zod';
import { AssetRef } from './asset.js';
import { Entity } from './entity.js';
import { Id, LayerId } from './ids.js';

export const Grid = z.object({
  type: z.enum(['square', 'hex']),
  sizePx: z.number().positive(),
  unitsPerCell: z.number().positive(),
  unitLabel: z.string(),
  diagonal: z.enum(['chebyshev', 'alternating', 'euclidean', 'manhattan']),
  snap: z.boolean(),
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
