import { QuickFields } from './quick-fields.js';
import { z } from 'zod';
import { AssetRef } from './asset.js';
import { Id, LayerId } from './ids.js';
import { EntityPermissions } from './permissions.js';
import { Transform } from './math.js';
import { isSimplePolygon } from '../geometry/polygon.js';

// Components over inheritance: an entity is defined by which components it has.
// MVP components only; later ones (trigger, wall, light, anim, fx, modData) are added as optional fields.
// D38: optional additive placeholder colour for tokens without an image (no schemaVersion bump).
export const TokenColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const StatusIcon = z.enum([
  'blinded',
  'charmed',
  'deafened',
  'frightened',
  'grappled',
  'incapacitated',
  'invisible',
  'paralyzed',
  'petrified',
  'poisoned',
  'prone',
  'restrained',
  'stunned',
  'unconscious',
  'exhaustion',
]);
export type StatusIcon = z.infer<typeof StatusIcon>;
export const TokenStatusMarker = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('icon'), icon: StatusIcon }),
  z.strictObject({ kind: z.literal('text'), text: z.string().trim().min(1).max(80) }),
]);
export type TokenStatusMarker = z.infer<typeof TokenStatusMarker>;
export const TokenStatusMarkers = z
  .array(TokenStatusMarker)
  .max(32)
  .refine(
    (markers) =>
      new Set(
        markers.map((marker) =>
          marker.kind === 'icon' ? `icon:${marker.icon}` : `text:${marker.text}`,
        ),
      ).size === markers.length,
    { message: 'duplicate status marker' },
  );
export const TokenRing = z.strictObject({
  radius: z.number().positive().max(10000),
  color: TokenColor,
});
export type TokenRing = z.infer<typeof TokenRing>;

const TokenComponent = z.object({
  sizeCells: z.number().positive(),
  heightCells: z.number().positive(),
  image: AssetRef.optional(),
  color: TokenColor.optional(),
  labelVisibility: z.enum(['all', 'owner', 'dm']),
  facing: z.number().optional(),
  characterInstanceId: Id.optional(),
  quickFields: QuickFields.optional(),
  statusMarkers: TokenStatusMarkers.optional(),
  rings: z.array(TokenRing).max(8).optional(),
  /** TOK-03: vertical position is locked; moves keep the height and ignore gravity. */
  flying: z.boolean().optional(),
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

const PinComponent = z.object({
  text: z.string(),
  reveal: z.union([z.enum(['hover', 'click']), z.object({ proximity: z.number().nonnegative() })]),
});

// FOG-01 (MV-295, save v12, D47 + MV-303): vision data. Points are in the entity's local XZ frame
// (world = transform.position + the point rotated by the entity yaw; scale ignored, see
// `localToWorldXZ`). zod 4 numbers are finite, so NaN and Infinity are rejected.
const LocalPoint = z.strictObject({ x: z.number(), z: z.number() });
export const MAX_VISION_POINTS = 64;

/** VIS-01: a door is open or closed; a secret door is sent to players as a plain wall while closed. */
export const DoorComponent = z.strictObject({ open: z.boolean(), secret: z.boolean().optional() });
export type DoorComponent = z.infer<typeof DoorComponent>;

/** VIS-01: a wall polyline; a door is a single 2-point segment. */
export const WallComponent = z
  .strictObject({
    points: z.array(LocalPoint).min(2).max(MAX_VISION_POINTS),
    door: DoorComponent.optional(),
  })
  .refine((wall) => wall.door === undefined || wall.points.length === 2, {
    message: 'a door has exactly 2 points',
    path: ['points'],
  });
export type WallComponent = z.infer<typeof WallComponent>;

/**
 * D47 (MV-303): a DM fog region on the map layer. Absent `revealed` means active (FOG-03 hides its
 * contents from players; this is data only); `revealed: true` keeps a revealed region for re-hiding.
 */
export const FogRegionComponent = z
  .strictObject({
    points: z.array(LocalPoint).min(3).max(MAX_VISION_POINTS),
    revealed: z.literal(true).optional(),
  })
  .refine((region) => isSimplePolygon(region.points), {
    message: 'a fog region must be a simple polygon',
    path: ['points'],
  });
export type FogRegionComponent = z.infer<typeof FogRegionComponent>;

/**
 * The entity fields without the cross-component vision rules. Use it only to derive partial
 * schemas (`.omit`, `.partial`); anything that stores or accepts a whole entity uses `Entity`.
 */
export const EntityFields = z.object({
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
  // MEAS-03: an immutable marker separates lasting objects from measuring templates.
  lastingAoE: z.strictObject({ creatorIdentityId: Id.optional() }).optional(),
  measuringAoE: z.literal(true).optional(),
  aura: z.object({ radius: z.number().positive(), color: z.string() }).optional(),
  pin: PinComponent.optional(),
  /** VIS-01 (FOG-01): a wall or door on the map layer, with no other components. */
  wall: WallComponent.optional(),
  /** VIS-02 (FOG-01): a shape or model prop that blocks dynamic-lighting sight. */
  blocksSight: z.literal(true).optional(),
  /** D47 (MV-303): a DM fog region on the map layer, with no other components. */
  fogRegion: FogRegionComponent.optional(),
});

type EntityShape = z.infer<typeof EntityFields>;

/** Components that make an entity something other than a wall or a fog region. */
const PLACEABLE_COMPONENTS = [
  'token',
  'shape',
  'model',
  'image',
  'aoe',
  'pin',
  'aura',
  'lastingAoE',
  'measuringAoE',
] as const satisfies readonly (keyof EntityShape)[];

function hasAny(entity: EntityShape, keys: readonly (keyof EntityShape)[]): boolean {
  return keys.some((key) => entity[key] !== undefined);
}

/**
 * FOG-01 (D47 + MV-303): why this entity breaks a vision rule, or undefined when it is valid.
 * One rule set for the schema refine and for every action that creates an entity or changes its
 * layer or components (`entity.create`, `entity.update`, `entity.setLayer`, `prefab.place`).
 * Occluders (walls, sight blockers) are data every player receives (D47 (4)), so they may never be
 * on the dm layer or hidden by `perms.view`. Fog regions live on the map layer like walls.
 */
export function visionRuleViolation(entity: EntityShape): string | undefined {
  if (entity.wall) {
    if (hasAny(entity, [...PLACEABLE_COMPONENTS, 'blocksSight', 'fogRegion']))
      return 'a wall has no other components';
    if (entity.layer !== 'map') return 'a wall lives on the map layer';
    if (entity.perms?.view === false) return 'a wall is visible to every player';
  }
  if (entity.fogRegion) {
    if (hasAny(entity, [...PLACEABLE_COMPONENTS, 'wall', 'blocksSight']))
      return 'a fog region has no other components';
    if (entity.layer !== 'map') return 'a fog region lives on the map layer';
  }
  if (entity.blocksSight) {
    if (!entity.shape && !entity.model) return 'only a shape or model prop can block sight';
    if (hasAny(entity, ['token', 'image', 'aoe', 'pin']))
      return 'only a shape or model prop can block sight';
    if (entity.layer === 'dm') return 'a sight-blocking prop cannot be on the dm layer';
    if (entity.perms?.view === false) return 'a sight-blocking prop is visible to every player';
  }
  return undefined;
}

export const Entity = EntityFields.superRefine((entity, ctx) => {
  const message = visionRuleViolation(entity);
  if (message) ctx.addIssue({ code: 'custom', message });
});
export type Entity = z.infer<typeof Entity>;

/** VIS-01: is this entity a wall (doors included)? */
export function isWall(entity: Pick<Entity, 'wall'>): boolean {
  return entity.wall !== undefined;
}

/** D47 (MV-303): is this entity a DM fog region? */
export function isFogRegion(entity: Pick<Entity, 'fogRegion'>): boolean {
  return entity.fogRegion !== undefined;
}

/** The exact entity accepted by `aoe.place`; unrelated components are deliberately excluded. */
export const AoEEntity = z.strictObject({
  id: Id,
  layer: LayerId,
  name: z.string(),
  owners: z.array(Id),
  perms: EntityPermissions.partial().optional(),
  transform: Transform,
  aoe: AoEShape,
  lastingAoE: z.strictObject({ creatorIdentityId: Id.optional() }).optional(),
  measuringAoE: z.literal(true).optional(),
});
export type AoEEntity = z.infer<typeof AoEEntity>;
