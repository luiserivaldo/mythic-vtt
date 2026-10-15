import {
  canPerform,
  yawFromQuaternion,
  type Actor,
  type Campaign,
  type Entity,
} from '@mythic/shared';
import {
  entityScale,
  entityExtents,
  snapFootprint,
  type GizmoDraft,
  type GizmoTarget,
} from './transform-gizmo.js';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface QuatLike extends Vec3Like {
  w: number;
}

export type Gizmo3DHandle =
  'move-xz' | 'move-x' | 'move-y' | 'move-z' | 'rotate-x' | 'rotate-y' | 'rotate-z';
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
  const { position, rotation } = entity.transform;
  return {
    x: position.x,
    y: position.y,
    z: position.z,
    yaw: yawFromQuaternion(rotation),
    rotation,
    scale: entityScale(entity),
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

/**
 * UI-TOKEN-07 proportions, in units of `reach` (HANDLE_LENGTH_PX). Arrows start away from the
 * centre so the entity's middle stays free for picking (F07); rings sit between.
 */
export const ARROW_START = 0.3;
export const ARROW_END = 1.15;
export const RING_RADIUS = 0.8;
const RING_SEGMENTS = 48;

export interface HandleShape {
  kind: Gizmo3DHandle;
  /** One point (the centre pad), an open polyline (arrow) or a closed loop (ring). */
  points: Vec3Like[];
  closed: boolean;
}

/** Arrows first, then rings, then the pad: on a tie the earlier shape wins the press. */
const SHAPE_ORDER: readonly Gizmo3DHandle[] = [
  'move-x',
  'move-y',
  'move-z',
  'rotate-x',
  'rotate-y',
  'rotate-z',
  'move-xz',
];

/** World-space handle shapes around `center`; `reach` is the world length of HANDLE_LENGTH_PX. */
export function handleShapes(
  center: Vec3Like,
  reach: number,
  kinds: readonly Gizmo3DHandle[],
): HandleShape[] {
  const at = (v: Vec3Like, s: number): Vec3Like => ({
    x: center.x + v.x * s * reach,
    y: center.y + v.y * s * reach,
    z: center.z + v.z * s * reach,
  });
  const arrow = (axis: RotationAxis): Vec3Like[] => [
    at(axisVector(axis), ARROW_START),
    at(axisVector(axis), ARROW_END),
  ];
  const ring = (axis: RotationAxis): Vec3Like[] =>
    Array.from({ length: RING_SEGMENTS }, (_, i) => {
      const a = (i / RING_SEGMENTS) * Math.PI * 2;
      const u = Math.cos(a);
      const v = Math.sin(a);
      const local =
        axis === 'x'
          ? { x: 0, y: u, z: v }
          : axis === 'y'
            ? { x: u, y: 0, z: v }
            : { x: u, y: v, z: 0 };
      return at(local, RING_RADIUS);
    });
  const build = (kind: Gizmo3DHandle): HandleShape => {
    if (kind === 'move-xz') return { kind, points: [center], closed: false };
    const axis = kind.slice(-1) as RotationAxis;
    return kind.startsWith('rotate')
      ? { kind, points: ring(axis), closed: true }
      : { kind, points: arrow(axis), closed: false };
  };
  return SHAPE_ORDER.filter((k) => kinds.includes(k)).map(build);
}

type Px = { x: number; y: number };

function pxToSegment(p: Px, a: Px, b: Px): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq < EPS ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Nearest projected shape within `radiusPx` of the pointer; null when the press misses all. */
export function hitScreenShape(
  pointer: Px,
  shapes: readonly { kind: Gizmo3DHandle; px: readonly Px[]; closed: boolean }[],
  radiusPx: number,
): Gizmo3DHandle | null {
  let best: Gizmo3DHandle | null = null;
  let bestDistance = Infinity;
  for (const s of shapes) {
    let d = Infinity;
    const n = s.px.length;
    const first = s.px[0];
    if (n === 1 && first) d = Math.hypot(pointer.x - first.x, pointer.y - first.y);
    const segments = s.closed ? n : n - 1;
    for (let i = 0; i < segments; i++) {
      const a = s.px[i];
      const b = s.px[(i + 1) % n];
      if (a && b) d = Math.min(d, pxToSegment(pointer, a, b));
    }
    if (d <= radiusPx && d < bestDistance - EPS) {
      best = s.kind;
      bestDistance = d;
    }
  }
  return best;
}

export function handlesFor(kind: 'prop' | 'token'): readonly Gizmo3DHandle[] {
  return kind === 'token' ? ['move-y'] : SHAPE_ORDER;
}

/** M1-47: footprint for the 3D gizmo's XZ move, using the same aspect as the 2D gizmo. */
export function gizmo3dMoveFootprint(entity: Entity, imageAspect = 1): number {
  return snapFootprint(entityExtents(entity, imageAspect));
}
