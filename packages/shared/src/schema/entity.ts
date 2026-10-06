import { z } from 'zod';
import { AssetRef } from './asset.js';
import { Id, LayerId } from './ids.js';
import { EntityPermissions } from './permissions.js';
import { Transform } from './math.js';

// Components over inheritance (TECHNICAL.md §5): an entity is defined by which components it has.
// MVP components only; later ones (trigger, wall, light, anim, fx, modData) are added as optional fields.
const TokenComponent = z.object({
  sizeCells: z.number().positive(),
  heightCells: z.number().positive(),
  image: AssetRef.optional(),
  labelVisibility: z.enum(['all', 'owner', 'dm']),
  facing: z.number().optional(),
  characterInstanceId: Id.optional(),
});

const ShapeComponent = z.object({
  kind: z.enum(['box', 'cylinder', 'cone', 'pyramid', 'sphere', 'plane', 'wedge']),
  color: z.string(),
  texture: AssetRef.optional(),
  walkable: z.boolean(),
  showGridOnTop: z.boolean().optional(),
});

const AoeComponent = z.object({
  kind: z.enum(['sphere', 'cylinder', 'cone', 'cube', 'line']),
  size: z.number().positive(),
  size2: z.number().positive().optional(),
  color: z.string(),
});

const PinComponent = z.object({
  text: z.string(),
  reveal: z.union([z.enum(['hover', 'click']), z.object({ proximity: z.number().nonnegative() })]),
});

export const Entity = z.object({
  id: Id,
  layer: LayerId,
  name: z.string(),
  owners: z.array(Id),
  perms: EntityPermissions.partial().optional(),
  transform: Transform,
  token: TokenComponent.optional(),
  shape: ShapeComponent.optional(),
  model: z.object({ asset: AssetRef }).optional(),
  image: z.object({ asset: AssetRef, calibrated: z.boolean() }).optional(),
  aoe: AoeComponent.optional(),
  aura: z.object({ radius: z.number().positive(), color: z.string() }).optional(),
  pin: PinComponent.optional(),
});
export type Entity = z.infer<typeof Entity>;
