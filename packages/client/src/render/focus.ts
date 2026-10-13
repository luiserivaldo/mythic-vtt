/**
 * M4-10 (CAM-06): pure maths for the double-click "focus on a token" camera move.
 *
 * Focus is a re-centring move: the 2D view keeps its zoom and the 3D orbit keeps its pose, so
 * only the look-at point travels. Both targets are clamped to the canvas (D37) and a non-finite
 * token position leaves the camera where it is rather than sending it to NaN.
 */
import { clampViewToBounds, type CanvasSize, type View2D } from './camera-2d.js';
import {
  clampOrbit,
  clampTargetToGround,
  GROUND_EPSILON,
  type GroundBounds,
  type Orbit3D,
} from './camera-3d.js';
import { TWEEN_MS } from './view-transition.js';

/** Interaction budget (TECHNICAL §6.5): a camera move answers in ≤ 300 ms. */
export const FOCUS_MS = TWEEN_MS;

/** The 2D view centred on a world X/Z, keeping `view`'s zoom and staying on the canvas. */
export function focusView2D(view: View2D, x: number, z: number, bounds: CanvasSize): View2D {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return view;
  return clampViewToBounds({ ...view, centerX: x, centerZ: z }, bounds);
}

/**
 * The orbit looking at a token at world X/Y/Z: azimuth, tilt and distance (and so the zoom) are
 * untouched. The focus height follows the token, so a flying token is framed where it is rather
 * than where it started.
 */
export function focusOrbit(
  orbit: Orbit3D,
  x: number,
  y: number,
  z: number,
  bounds: GroundBounds | null,
): Orbit3D {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return orbit;
  const targetY = Number.isFinite(y) ? Math.max(GROUND_EPSILON, y) : GROUND_EPSILON;
  return clampOrbit(clampTargetToGround({ ...orbit, targetX: x, targetZ: z, targetY }, bounds));
}

/** Interpolate a 2D view; the endpoints are returned exactly and NaN reads as still at the start. */
export function lerpView2D(a: View2D, b: View2D, t: number): View2D {
  if (!(t > 0)) return a;
  if (t >= 1) return b;
  return {
    centerX: a.centerX + (b.centerX - a.centerX) * t,
    centerZ: a.centerZ + (b.centerZ - a.centerZ) * t,
    zoom: a.zoom + (b.zoom - a.zoom) * t,
  };
}
