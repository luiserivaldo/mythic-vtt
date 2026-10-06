import type { Entity } from '../schema/index.js';
import {
  primitiveDimensions,
  primitiveTopHeight,
  yawFromQuaternion,
  type PrimitiveKind,
} from './primitives.js';

// ENV-04. Where a token stands. Pure: no DOM, clocks or randomness (AGENTS.md rule 2).
//
// Height profiles, measured above the entity's base elevation (position.y). With (u, v) the point in
// the primitive's local frame (yaw undone, origin at the footprint centre), hx/hz the half extents
// and h the top height:
//   box, plane, cylinder  flat top: h inside the footprint (cylinder: the ellipse).
//   wedge                 linear ramp: h * (v + hz) / depth, rising toward +z (TECHNICAL.md §6.2).
//   cone                  h * (1 - r), r = sqrt((u/hx)^2 + (v/hz)^2).
//   pyramid               h * (1 - max(|u|/hx, |v|/hz)).
//   sphere                upper half of an ellipsoid sitting on its base: h * (1 + sqrt(1 - r^2)) / 2,
//                         so the rim (r = 1, the equator) stands at h / 2.
// Outside the footprint a primitive contributes nothing. Boundary points are inside.

/** What the surface queries need from a walkable entity. `yaw` is radians about Y. */
export interface WalkableSurface {
  kind: PrimitiveKind;
  /** Footprint centre at the base; `y` is the base elevation, so stacked platforms just work. */
  position: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
  yaw?: number;
}

export interface SurfaceHeightOptions {
  /**
   * Elevation of whoever is asking (a token's feet). When given, only surfaces at or below
   * `currentElevation + maxStepUp` count, so a token standing on or under a platform is not
   * snapped up through a ceiling. When omitted, the highest surface overall wins.
   */
  currentElevation?: number;
  /** Tolerance for stepping up onto a surface, in cells. Default 0.5. Only used with `currentElevation`. */
  maxStepUp?: number;
}

export const GROUND_ELEVATION = 0;
export const DEFAULT_MAX_STEP_UP = 0.5;
const EPS = 1e-9;

/** The walkable form of an entity, or undefined when it has no shape or is not walkable. */
export function walkableFromEntity(
  entity: Pick<Entity, 'transform' | 'shape'>,
): WalkableSurface | undefined {
  const { shape, transform } = entity;
  if (!shape?.walkable) return undefined;
  return {
    kind: shape.kind,
    position: transform.position,
    scale: transform.scale,
    yaw: yawFromQuaternion(transform.rotation),
  };
}

/** Height of one primitive's top above its base at a world point, or undefined outside it. */
export function primitiveProfileHeight(
  w: WalkableSurface,
  x: number,
  z: number,
): number | undefined {
  const { width, depth, height } = primitiveDimensions(w.kind, w.scale);
  const top = primitiveTopHeight(w.kind, height);
  const hx = width / 2;
  const hz = depth / 2;
  const dx = x - w.position.x;
  const dz = z - w.position.z;
  const yaw = w.yaw ?? 0;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // Inverse of the footprint rotation in primitives.ts.
  const u = c * dx - s * dz;
  const v = s * dx + c * dz;
  const nu = Math.abs(u) / hx;
  const nv = Math.abs(v) / hz;
  switch (w.kind) {
    case 'box':
    case 'plane':
      return nu <= 1 + EPS && nv <= 1 + EPS ? top : undefined;
    case 'wedge':
      return nu <= 1 + EPS && nv <= 1 + EPS
        ? (top * Math.min(Math.max(v + hz, 0), depth)) / depth
        : undefined;
    case 'pyramid': {
      const m = Math.max(nu, nv);
      return m <= 1 + EPS ? top * Math.max(1 - m, 0) : undefined;
    }
    case 'cylinder':
    case 'cone':
    case 'sphere': {
      const r2 = nu * nu + nv * nv;
      if (r2 > 1 + EPS) return undefined;
      if (w.kind === 'cylinder') return top;
      if (w.kind === 'cone') return top * Math.max(1 - Math.sqrt(r2), 0);
      return (top * (1 + Math.sqrt(Math.max(1 - r2, 0)))) / 2;
    }
  }
}

/**
 * Highest walkable surface elevation at (x, z), or the ground (0) when none applies.
 * See SurfaceHeightOptions for how `currentElevation` limits the choice among stacked surfaces.
 */
export function surfaceHeightAt(
  x: number,
  z: number,
  walkables: readonly WalkableSurface[],
  options: SurfaceHeightOptions = {},
): number {
  const { currentElevation } = options;
  const limit =
    currentElevation === undefined
      ? Infinity
      : currentElevation + Math.max(options.maxStepUp ?? DEFAULT_MAX_STEP_UP, 0) + EPS;
  let best = GROUND_ELEVATION;
  for (const w of walkables) {
    const h = primitiveProfileHeight(w, x, z);
    if (h === undefined) continue;
    const elevation = w.position.y + h;
    if (elevation <= limit && elevation > best) best = elevation;
  }
  return best;
}

/**
 * Elevation a token takes when dropped at `position` (D25: exact surface height, no grid snap).
 * The drop elevation counts as the current elevation, so dropping beneath a ceiling stays beneath
 * it and dropping high above a platform lands on it.
 */
export function dropElevation(
  position: { x: number; y: number; z: number },
  walkables: readonly WalkableSurface[],
  maxStepUp: number = DEFAULT_MAX_STEP_UP,
): number {
  return surfaceHeightAt(position.x, position.z, walkables, {
    currentElevation: position.y,
    maxStepUp,
  });
}
