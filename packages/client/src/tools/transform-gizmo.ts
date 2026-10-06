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

export type HandleKind = 'move' | 'rotate' | 'scale';

export const ROTATION_STEP_DEG = 15;
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 100;
export const MAX_COORD_CELLS = 1_000_000;
export const HANDLE_HIT_PX = 12;
export const ROTATE_OFFSET_PX = 22;
export const SCALE_OFFSET_PX = 14;

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
export function entityExtents(entity: Entity): { width: number; depth: number } {
  if (entity.shape) {
    const { width, depth } = primitiveDimensions(entity.shape.kind, entity.transform.scale);
    return { width, depth };
  }
  if (entity.token) {
    const size = footprintCells(entity.token.sizeCells);
    return { width: size, depth: size };
  }
  return { width: 1, depth: 1 };
}

/** Whole-cell footprint used to choose centre (odd) vs corner (even) snapping. */
export function snapFootprint(extents: { width: number; depth: number }): number {
  return Math.max(1, Math.round(Math.max(extents.width, extents.depth)));
}

export function draftFromEntity(entity: Entity): GizmoDraft {
  const { position, rotation, scale } = entity.transform;
  return { x: position.x, z: position.z, yaw: yawFromQuaternion(rotation), scale: scale.x };
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

export interface HandleLayout {
  move: Xz;
  rotate: Xz;
  scale: Xz;
}

/** `worldPerPx` keeps handle offsets a constant screen size at any zoom. */
export function handleLayout(
  center: Xz,
  yaw: number,
  halfExtent: number,
  worldPerPx: number,
): HandleLayout {
  const reach = halfExtent + ROTATE_OFFSET_PX * worldPerPx;
  const corner = halfExtent + SCALE_OFFSET_PX * worldPerPx;
  return {
    move: center,
    // Direction at `yaw` in the world XZ plane (x' = cos, z' = -sin; see primitives.ts `rotate`).
    rotate: { x: center.x + Math.cos(yaw) * reach, z: center.z - Math.sin(yaw) * reach },
    scale: { x: center.x + corner, z: center.z + corner },
  };
}

const HANDLE_PRIORITY: readonly HandleKind[] = ['rotate', 'scale', 'move'];

/**
 * Which handle a press lands on. The nearest within the hit radius wins; on a tie the outer
 * handles beat `move`, which sits on top of the entity and would otherwise swallow them.
 */
export function hitHandle(
  point: Xz,
  layout: HandleLayout,
  hitRadiusWorld: number,
): HandleKind | null {
  let best: HandleKind | null = null;
  let bestDistance = Infinity;
  for (const kind of HANDLE_PRIORITY) {
    const handle = layout[kind];
    const distance = Math.hypot(point.x - handle.x, point.z - handle.z);
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
