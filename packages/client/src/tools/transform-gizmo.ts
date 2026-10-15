import {
  canPerform,
  primitiveDimensions,
  snapToGrid,
  UnsupportedGridError,
  yawFromQuaternion,
  type Actor,
  type Campaign,
  type Entity,
  type Grid,
  type Scene,
  type Transform,
  type Vec3,
} from '@mythic/shared';
import { footprintCells } from '../render/token-footprint.js';

// ENV-03 (2D). Pure maths for the transform gizmo: hit-testing, snapping, rotation, typed values.
// Positions are grid cells on the XZ plane; yaw is radians about +Y, the same
// sense as three.js and `yawFromQuaternion`.

export interface Xz {
  x: number;
  z: number;
}

/** Editable parts of a transform on the 2D plane. Elevation (y) is never touched here. */
export interface GizmoDraft {
  x: number;
  z: number;
  /** M2-08: present for a 3D elevation preview; absent keeps the stored elevation. */
  y?: number;
  /** Radians, normalised to (-PI, PI]. */
  yaw: number;
  /** M2-08: full 3-axis rotation; absent keeps the 2D yaw behaviour. */
  rotation?: Transform['rotation'];
  /** Uniform scale factor (transform.scale.x). */
  scale: number;
}

export type HandleKind = 'move' | 'move-x' | 'move-z' | 'rotate' | 'scale';

export const ROTATION_STEP_DEG = 15;
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 100;
export const MAX_COORD_CELLS = 1_000_000;
export const HANDLE_HIT_PX = 10;

const EPS = 1e-9;

/** D25: snapping follows the scene grid (`grid.snap`), so hex grids fall back to free placement. */
function snapPosition(position: Vec3, grid: Grid, footprint: number): Vec3 {
  try {
    return snapToGrid(position, grid, { footprint });
  } catch (error) {
    if (error instanceof UnsupportedGridError) return position;
    throw error;
  }
}

export function normalizeYaw(yaw: number): number {
  const twoPi = Math.PI * 2;
  let y = yaw % twoPi;
  if (y > Math.PI) y -= twoPi;
  if (y <= -Math.PI) y += twoPi;
  return y;
}

export function quaternionFromYaw(yaw: number): Transform['rotation'] {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

/** Footprint box in cells (before the gizmo's own scale factor). */
export function entityExtents(entity: Entity, imageAspect = 1): { width: number; depth: number } {
  if (entity.shape) {
    const { width, depth } = primitiveDimensions(entity.shape.kind, entity.transform.scale);
    return { width, depth };
  }
  if (entity.token) {
    const size = footprintCells(entity.token.sizeCells);
    return { width: size, depth: size };
  }
  if (entity.layer === 'map' && entity.image) {
    // ENV-01: scale.x is image height; texture dimensions determine width.
    const aspect = Number.isFinite(imageAspect) && imageAspect > 0 ? imageAspect : 1;
    return { width: entity.transform.scale.x * aspect, depth: entity.transform.scale.x };
  }
  return { width: 1, depth: 1 };
}

/** Whole-cell footprint used to choose centre (odd) vs corner (even) snapping. */
export function snapFootprint(extents: { width: number; depth: number }): number {
  return Math.max(1, Math.round(Math.max(extents.width, extents.depth)));
}

/** M1-35: tokens author their uniform size in `token.sizeCells`; other entities use transform scale. */
export function entityScale(entity: Entity): number {
  return entity.token ? footprintCells(entity.token.sizeCells) : entity.transform.scale.x;
}

export function draftFromEntity(entity: Entity): GizmoDraft {
  const { position, rotation } = entity.transform;
  return {
    x: position.x,
    z: position.z,
    yaw: yawFromQuaternion(rotation),
    scale: entityScale(entity),
  };
}

/** Apply a draft to the stored transform: untouched parts keep their exact stored values. */
export function buildTransform(base: Transform, draft: GizmoDraft): Transform {
  const sameYaw = Math.abs(normalizeYaw(draft.yaw - yawFromQuaternion(base.rotation))) < EPS;
  const ratio = Math.abs(base.scale.x) < EPS ? null : draft.scale / base.scale.x;
  return {
    position: { x: draft.x, y: draft.y ?? base.position.y, z: draft.z },
    rotation: draft.rotation ?? (sameYaw ? base.rotation : quaternionFromYaw(draft.yaw)),
    scale:
      ratio === null
        ? { x: draft.scale, y: draft.scale, z: draft.scale }
        : { x: draft.scale, y: base.scale.y * ratio, z: base.scale.z * ratio },
  };
}

export function sameTransform(a: Transform, b: Transform): boolean {
  const close = (p: number, q: number) => Math.abs(p - q) < 1e-9;
  return (
    close(a.position.x, b.position.x) &&
    close(a.position.y, b.position.y) &&
    close(a.position.z, b.position.z) &&
    close(a.rotation.x, b.rotation.x) &&
    close(a.rotation.y, b.rotation.y) &&
    close(a.rotation.z, b.rotation.z) &&
    close(a.rotation.w, b.rotation.w) &&
    close(a.scale.x, b.scale.x) &&
    close(a.scale.y, b.scale.y) &&
    close(a.scale.z, b.scale.z)
  );
}

// ---- Handles ---------------------------------------------------------------------------------

/**
 * UI-TOKEN-07 pixel sizes. The rotate ring circles the footprint, the axis arrows start just
 * outside the ring and the scale squares sit on the footprint corners, so no handle covers the
 * middle of the entity, where presses belong to picking and token drag (F07).
 */
export const RING_GAP_PX = 14;
export const ARROW_START_PX = 6;
export const ARROW_LENGTH_PX = 38;
export const SCALE_SQUARE_PX = 9;
export const MOVE_PAD_PX = 9;
/**
 * Scale squares never sit closer to the centre than this, so on a small footprint (a Tiny token
 * at low zoom) they stay clear of the body and a press on it is still token drag.
 */
export const MIN_CORNER_PX = 2 * HANDLE_HIT_PX;

export interface HandleLayout {
  center: Xz;
  /** Free XZ move pad at the centre; only non-token entities get one (tokens drag by the body). */
  move: Xz | null;
  /** Arrow segments along the world axes (Unity "global"): X red, Z blue. */
  moveX: { from: Xz; to: Xz };
  moveZ: { from: Xz; to: Xz };
  /** Rotate ring radius (yaw about Y, green). */
  ringRadius: number;
  /**
   * Uniform scale squares on the four footprint corners, turned with the entity's yaw; pushed
   * out along the diagonals to `MIN_CORNER_PX` on footprints smaller than that.
   */
  corners: readonly Xz[];
}

/** `worldPerPx` keeps handle offsets a constant screen size at any zoom. */
export function handleLayout(args: {
  center: Xz;
  yaw: number;
  halfWidth: number;
  halfDepth: number;
  worldPerPx: number;
  freeMove: boolean;
}): HandleLayout {
  const { center, yaw, worldPerPx: wpp } = args;
  const cornerDistance = Math.hypot(args.halfWidth, args.halfDepth);
  const minCorner = MIN_CORNER_PX * wpp;
  const spread =
    cornerDistance > EPS && cornerDistance < minCorner ? minCorner / cornerDistance : 1;
  const halfWidth = cornerDistance > EPS ? args.halfWidth * spread : minCorner / Math.SQRT2;
  const halfDepth = cornerDistance > EPS ? args.halfDepth * spread : minCorner / Math.SQRT2;
  const ringRadius = Math.hypot(halfWidth, halfDepth) + RING_GAP_PX * wpp;
  const start = ringRadius + ARROW_START_PX * wpp;
  const end = start + ARROW_LENGTH_PX * wpp;
  // The drawn outline's rotation (three.js yaw about +Y): x' = x cos + z sin, z' = z cos - x sin.
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const corners = [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ].map(([sx = 0, sz = 0]) => {
    const lx = sx * halfWidth;
    const lz = sz * halfDepth;
    return { x: center.x + lx * cos + lz * sin, z: center.z - lx * sin + lz * cos };
  });
  return {
    center,
    move: args.freeMove ? center : null,
    moveX: { from: { x: center.x + start, z: center.z }, to: { x: center.x + end, z: center.z } },
    moveZ: { from: { x: center.x, z: center.z + start }, to: { x: center.x, z: center.z + end } },
    ringRadius,
    corners,
  };
}

/** The layout drawn and hit-tested for `entity` at `draft` (the live preview while dragging). */
export function layoutForDraft(
  entity: Entity,
  draft: GizmoDraft,
  worldPerPx: number,
  imageAspect = 1,
): HandleLayout {
  const extents = entityExtents(entity, imageAspect);
  const ratio = draft.scale / (entityScale(entity) || 1);
  return handleLayout({
    center: { x: draft.x, z: draft.z },
    yaw: draft.yaw,
    halfWidth: (extents.width * ratio) / 2,
    halfDepth: (extents.depth * ratio) / 2,
    worldPerPx,
    freeMove: !entity.token,
  });
}

function distanceToSegment(p: Xz, a: Xz, b: Xz): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;
  const t =
    lengthSq < EPS ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
}

/**
 * Which handle a press lands on. The nearest within the hit radius wins; on a tie the earlier
 * kind wins (scale squares, then arrows, then the ring, then the centre pad).
 */
export function hitHandle(
  point: Xz,
  layout: HandleLayout,
  hitRadiusWorld: number,
): HandleKind | null {
  const fromCenter = Math.hypot(point.x - layout.center.x, point.z - layout.center.z);
  const candidates: [HandleKind, number][] = [
    ['scale', Math.min(...layout.corners.map((c) => Math.hypot(point.x - c.x, point.z - c.z)))],
    ['move-x', distanceToSegment(point, layout.moveX.from, layout.moveX.to)],
    ['move-z', distanceToSegment(point, layout.moveZ.from, layout.moveZ.to)],
    ['rotate', Math.abs(fromCenter - layout.ringRadius)],
  ];
  if (layout.move) candidates.push(['move', fromCenter]);
  let best: HandleKind | null = null;
  let bestDistance = Infinity;
  for (const [kind, distance] of candidates) {
    if (distance <= hitRadiusWorld && distance < bestDistance - EPS) {
      best = kind;
      bestDistance = distance;
    }
  }
  return best;
}

// ---- Drags -----------------------------------------------------------------------------------

export function applyMove(args: {
  start: Xz;
  pointerStart: Xz;
  pointer: Xz;
  grid: Grid;
  footprint: number;
  /** Entity elevation passes through snapping unchanged. */
  y?: number;
}): Xz {
  const raw: Vec3 = {
    x: args.start.x + (args.pointer.x - args.pointerStart.x),
    y: args.y ?? 0,
    z: args.start.z + (args.pointer.z - args.pointerStart.z),
  };
  const snapped = snapPosition(raw, args.grid, args.footprint);
  return { x: snapped.x, z: snapped.z };
}

/** UI-TOKEN-07 axis arrow: the usual snapped move, keeping the other coordinate unchanged. */
export function applyAxisMove(args: Parameters<typeof applyMove>[0] & { axis: 'x' | 'z' }): Xz {
  const moved = applyMove(args);
  return args.axis === 'x' ? { x: moved.x, z: args.start.z } : { x: args.start.x, z: moved.z };
}

/** Pointer angle about `center` in the same sense as yaw. */
export function pointerAngle(center: Xz, pointer: Xz): number {
  return Math.atan2(-(pointer.z - center.z), pointer.x - center.x);
}

export function applyRotate(args: {
  center: Xz;
  pointerStart: Xz;
  pointer: Xz;
  startYaw: number;
  grid: Grid;
}): number {
  const { center, pointer, pointerStart, startYaw, grid } = args;
  if (Math.hypot(pointer.x - center.x, pointer.z - center.z) < 1e-6) return startYaw;
  const yaw = startYaw + pointerAngle(center, pointer) - pointerAngle(center, pointerStart);
  if (!grid.snap) return normalizeYaw(yaw);
  const step = (ROTATION_STEP_DEG * Math.PI) / 180;
  return normalizeYaw(Math.round(yaw / step) * step);
}

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** Scale follows the pointer's distance from the centre; snapped to whole grid units on a snapping grid. */
export function applyScale(args: {
  center: Xz;
  pointerStart: Xz;
  pointer: Xz;
  startScale: number;
  grid: Grid;
}): number {
  const { center, pointer, pointerStart, startScale, grid } = args;
  const startDistance = Math.hypot(pointerStart.x - center.x, pointerStart.z - center.z);
  if (startDistance < 1e-6) return startScale;
  const raw = startScale * (Math.hypot(pointer.x - center.x, pointer.z - center.z) / startDistance);
  return clampScale(grid.snap ? Math.max(1, Math.round(raw)) : raw);
}

// ---- Typed values ----------------------------------------------------------------------------

export interface TypedInput {
  x: string;
  z: string;
  rotation: string;
  scale: string;
}

export type TypedField = keyof TypedInput;

export type TypedResult =
  { ok: true; draft: GizmoDraft } | { ok: false; errors: Partial<Record<TypedField, string>> };

export function parseNumber(text: string): number | null {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '' || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** User-visible distances are scene units (`unitsPerCell`); the draft stores cells. */
export function parseTypedValues(input: TypedInput, unitsPerCell: number): TypedResult {
  const errors: Partial<Record<TypedField, string>> = {};
  const coord = (field: 'x' | 'z'): number => {
    const value = parseNumber(input[field]);
    if (value === null) {
      errors[field] = 'Enter a number.';
      return 0;
    }
    const cells = value / unitsPerCell;
    if (Math.abs(cells) > MAX_COORD_CELLS) {
      errors[field] = 'That is too far from the origin.';
      return 0;
    }
    return cells;
  };
  const x = coord('x');
  const z = coord('z');

  const degrees = parseNumber(input.rotation);
  if (degrees === null) errors.rotation = 'Enter an angle in degrees.';

  const scale = parseNumber(input.scale);
  if (scale === null) errors.scale = 'Enter a number.';
  else if (scale < MIN_SCALE || scale > MAX_SCALE)
    errors.scale = `Scale must be between ${String(MIN_SCALE)} and ${String(MAX_SCALE)}.`;

  if (Object.keys(errors).length > 0 || degrees === null || scale === null)
    return { ok: false, errors };
  return { ok: true, draft: { x, z, yaw: normalizeYaw((degrees * Math.PI) / 180), scale } };
}

const trim = (n: number): string => String(Number(n.toFixed(4)));

export function formatTyped(draft: GizmoDraft, unitsPerCell: number): TypedInput {
  const degrees = (draft.yaw * 180) / Math.PI;
  return {
    x: trim(draft.x * unitsPerCell),
    z: trim(draft.z * unitsPerCell),
    rotation: trim(degrees),
    scale: trim(draft.scale),
  };
}

// ---- Target ----------------------------------------------------------------------------------

export interface GizmoTarget {
  scene: Scene;
  entity: Entity;
}

/**
 * PERM-01/02, D23: handles show only when the host would accept a transform change from this
 * viewer (the same shared permission check the host runs), for exactly one selected entity.
 */
export function resolveGizmoTarget(
  campaign: Campaign | null,
  selectedIds: readonly string[],
  actor: Actor | null,
): GizmoTarget | null {
  if (!campaign?.activeSceneId || !actor || selectedIds.length !== 1) return null;
  const scene = campaign.scenes[campaign.activeSceneId];
  const id = selectedIds[0];
  const entity = id === undefined ? undefined : scene?.entities[id];
  if (!scene || !entity) return null;
  const allowed = canPerform(campaign, actor, 'entity.update', {
    sceneId: scene.id,
    entityId: entity.id,
    changes: { transform: entity.transform },
  });
  return allowed ? { scene, entity } : null;
}
