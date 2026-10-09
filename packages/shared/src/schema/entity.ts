import { z } from 'zod';
import { AssetRef } from './asset.js';
import { Id, LayerId } from './ids.js';
import { EntityPermissions } from './permissions.js';
import { Transform } from './math.js';

// Components over inheritance: an entity is defined by which components it has.
// MVP components only; later ones (trigger, wall, light, anim, fx, modData) are added as optional fields.
// D38: optional additive placeholder colour for tokens without an image (no schemaVersion bump).
export const TokenColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const TokenComponent = z.object({
  sizeCells: z.number().positive(),
  heightCells: z.number().positive(),
  image: AssetRef.optional(),
  color: TokenColor.optional(),
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

const dimension = z.number().nonnegative();

// MEAS-03: these names intentionally match shared/geometry's AoE inputs. Cones and lines
// originate at the entity transform and extend along local +Z.
export const AoEShape = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('sphere'), radius: dimension, color: z.string() }),
  z.strictObject({
    kind: z.literal('cylinder'),
    radius: dimension,
    height: dimension,
    color: z.string(),
  }),
  z.strictObject({
    kind: z.literal('cone'),
    radius: dimension,
    length: dimension,
    color: z.string(),
  }),
  z.strictObject({ kind: z.literal('cube'), size: dimension, color: z.string() }),
  z.strictObject({
    kind: z.literal('line'),
    length: dimension,
    width: dimension,
    height: dimension,
    color: z.string(),
  }),
]);
export type AoEShape = z.infer<typeof AoEShape>;

// The pre-M3 placeholder remains readable so adding the concrete shape schemas is additive.
const LegacyAoEComponent = z.strictObject({
  kind: z.enum(['sphere', 'cylinder', 'cone', 'cube', 'line']),
  size: dimension,
  size2: dimension.optional(),
  color: z.string(),
});
const AoEComponent = z.union([AoEShape, LegacyAoEComponent]);

export const PIN_TEXT_MAX_LENGTH = 4_096;

export const PinReveal = z.union([
  z.enum(['hover', 'click']),
  z.strictObject({ proximity: z.number().nonnegative() }),
]);
export type PinReveal = z.infer<typeof PinReveal>;

// TRIG-01: keep notes bounded at the state boundary because the full text is durable and shared.
export const PinComponent = z.strictObject({
  text: z.string().min(1).max(PIN_TEXT_MAX_LENGTH),
  reveal: PinReveal,
});
export type PinComponent = z.infer<typeof PinComponent>;

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
  aoe: AoEComponent.optional(),
  aura: z.object({ radius: z.number().positive(), color: z.string() }).optional(),
  pin: PinComponent.optional(),
});
export type Entity = z.infer<typeof Entity>;

/** The exact entity accepted by `aoe.place`; unrelated components are deliberately excluded. */
export const AoEEntity = z.strictObject({
  id: Id,
  layer: LayerId,
  name: z.string(),
  owners: z.array(Id),
  perms: EntityPermissions.partial().optional(),
  transform: Transform,
  aoe: AoEShape,
});
export type AoEEntity = z.infer<typeof AoEEntity>;
