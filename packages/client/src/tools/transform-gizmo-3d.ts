import {
  canPerform,
  yawFromQuaternion,
  type Actor,
  type Campaign,
  type Entity,
} from '@mythic/shared';
import type { GizmoDraft, GizmoTarget } from './transform-gizmo.js';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface QuatLike extends Vec3Like {
  w: number;
}

export type Gizmo3DHandle = 'move-xz' | 'move-y' | 'rotate-x' | 'rotate-y' | 'rotate-z';
export type RotationAxis = 'x' | 'y' | 'z';

export const ROTATION_STEP = Math.PI / 12;
const EPS = 1e-8;

const dot = (a: Vec3Like, b: Vec3Like) => a.x * b.x + a.y * b.y + a.z * b.z;
const subtract = (a: Vec3Like, b: Vec3Like): Vec3Like => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});
const cross = (a: Vec3Like, b: Vec3Like): Vec3Like => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

export function axisVector(axis: RotationAxis): Vec3Like {
  return axis === 'x'
    ? { x: 1, y: 0, z: 0 }
    : axis === 'y'
      ? { x: 0, y: 1, z: 0 }
      : { x: 0, y: 0, z: 1 };
}

/** Closest point on an infinite axis to a pointer ray, expressed as distance along the axis. */
export function projectRayToAxis(
  rayOrigin: Vec3Like,
  rayDirection: Vec3Like,
  axisOrigin: Vec3Like,
  axisDirection: Vec3Like,
): number | null {
  const w = subtract(rayOrigin, axisOrigin);
  const a = dot(rayDirection, rayDirection);
  const b = dot(rayDirection, axisDirection);
  const c = dot(axisDirection, axisDirection);
  const d = dot(rayDirection, w);
  const e = dot(axisDirection, w);
  const denominator = a * c - b * b;
  if (Math.abs(denominator) < EPS) return null;
  return (a * e - b * d) / denominator;
}

/** Pointer ray intersection with a plane. Parallel rays have no stable projection. */
export function intersectRayPlane(
  rayOrigin: Vec3Like,
  rayDirection: Vec3Like,
  planePoint: Vec3Like,
  planeNormal: Vec3Like,
): Vec3Like | null {
  const denominator = dot(rayDirection, planeNormal);
  if (Math.abs(denominator) < EPS) return null;
  const distance = dot(subtract(planePoint, rayOrigin), planeNormal) / denominator;
  if (distance < 0) return null;
  return {
    x: rayOrigin.x + rayDirection.x * distance,
    y: rayOrigin.y + rayDirection.y * distance,
    z: rayOrigin.z + rayDirection.z * distance,
  };
}

export function signedAngleAroundAxis(from: Vec3Like, to: Vec3Like, axis: Vec3Like): number {
  return Math.atan2(dot(axis, cross(from, to)), dot(from, to));
}

export function snapLinear(value: number, enabled: boolean): number {
  return enabled ? Math.round(value) : value;
}

export function snapRotation(angle: number, enabled: boolean): number {
  return enabled ? Math.round(angle / ROTATION_STEP) * ROTATION_STEP : angle;
}

export function quaternionFromAxisAngle(axis: Vec3Like, angle: number): QuatLike {
  const half = angle / 2;
  const s = Math.sin(half);
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(half) };
}

export function multiplyQuaternions(a: QuatLike, b: QuatLike): QuatLike {
  const q = {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
  const length = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / length, y: q.y / length, z: q.z / length, w: q.w / length };
}

/** Apply a world-axis rotation to the transform that existed when the drag began. */
export function rotateDraft(
  start: QuatLike,
  axis: RotationAxis,
  angle: number,
  snap: boolean,
): QuatLike {
  return multiplyQuaternions(
    quaternionFromAxisAngle(axisVector(axis), snapRotation(angle, snap)),
    start,
  );
}

export function draft3dFromEntity(entity: Entity): GizmoDraft {
  const { position, rotation, scale } = entity.transform;
  return {
    x: position.x,
    y: position.y,
    z: position.z,
    yaw: yawFromQuaternion(rotation),
    rotation,
    scale: scale.x,
  };
}

export interface Gizmo3DTarget extends GizmoTarget {
  kind: 'prop' | 'token';
}

/** M2-08: props/primitives get every handle; tokens get elevation only. */
export function resolveGizmo3DTarget(
  campaign: Campaign | null,
  selectedIds: readonly string[],
  actor: Actor | null,
): Gizmo3DTarget | null {
  if (!campaign?.activeSceneId || !actor || selectedIds.length !== 1) return null;
  const scene = campaign.scenes[campaign.activeSceneId];
  const id = selectedIds[0];
  const entity = id === undefined ? undefined : scene?.entities[id];
  if (!scene || !entity || (!entity.shape && !entity.model && !entity.token)) return null;
  const allowed = canPerform(campaign, actor, 'entity.update', {
    sceneId: scene.id,
    entityId: entity.id,
    changes: { transform: entity.transform },
  });
  if (!allowed) return null;
  return { scene, entity, kind: entity.token ? 'token' : 'prop' };
}

// ---- Handle layout and hit-testing (screen space) --------------------------------------------

export const HANDLE_LENGTH_PX = 70;
export const HANDLE_HIT_PX_3D = 14;

/** World size of `px` screen pixels at `distance` from a perspective camera (constant-size handles). */
export function worldPerPixelAt(
  distance: number,
  fovDegrees: number,
  viewportHeightPx: number,
): number {
  if (viewportHeightPx <= 0) return 0;
  return (2 * Math.max(distance, 0) * Math.tan((fovDegrees * Math.PI) / 360)) / viewportHeightPx;
}

/** World-space handle anchors around `center`; `reach` is the world length of HANDLE_LENGTH_PX. */
export function handleAnchors(
  center: Vec3Like,
  reach: number,
  kinds: readonly Gizmo3DHandle[],
): { kind: Gizmo3DHandle; position: Vec3Like }[] {
  const at = (dx: number, dy: number, dz: number): Vec3Like => ({
    x: center.x + dx * reach,
    y: center.y + dy * reach,
    z: center.z + dz * reach,
  });
  const all: Record<Gizmo3DHandle, Vec3Like> = {
    'move-xz': center,
    'move-y': at(0, 1, 0),
    // Each rotate handle lies in the plane it turns the entity through.
    'rotate-x': at(0, 0, 1),
    'rotate-y': at(-1, 0, 0),
    'rotate-z': at(1, 0, 0),
  };
  return kinds.map((kind) => ({ kind, position: all[kind] }));
}

/** Nearest handle within `radiusPx` of the pointer; null when the press misses every handle. */
export function hitScreenHandle(
  pointer: { x: number; y: number },
  handles: readonly { kind: Gizmo3DHandle; px: { x: number; y: number } }[],
  radiusPx: number,
): Gizmo3DHandle | null {
  let best: Gizmo3DHandle | null = null;
  let bestDistance = Infinity;
  for (const h of handles) {
    const d = Math.hypot(pointer.x - h.px.x, pointer.y - h.px.y);
    if (d <= radiusPx && d < bestDistance) {
      best = h.kind;
      bestDistance = d;
    }
  }
  return best;
}

export function handlesFor(kind: 'prop' | 'token'): readonly Gizmo3DHandle[] {
  return kind === 'token' ? ['move-y'] : ['move-xz', 'move-y', 'rotate-x', 'rotate-y', 'rotate-z'];
}
