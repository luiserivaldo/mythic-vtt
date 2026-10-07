/**
 * Pure maths for the 2D <-> 3D view tween (M2-05, CAM-02/CAM-04). No DOM or Three.js.
 *
 * The 2D orthographic camera and the 3D orbit camera are matched at the seam: a 2D view
 * (focus point + pixels per cell) maps to a near top-down orbit that shows the same ground
 * extent, so swapping cameras at either end of the tween is invisible.
 */
import {
  DEFAULT_FOV_DEGREES,
  GROUND_EPSILON,
  MIN_POLAR,
  normalizeAngle,
  type Orbit3D,
} from './camera-3d.js';
import { clampZoom, type View2D } from './camera-2d.js';

/** Upper bound from the task (<= 300 ms); the tween itself is a touch shorter. */
export const MAX_TWEEN_MS = 300;
export const TWEEN_MS = 250;
/** 2D screen-up is world -Z, which is azimuth 0 for the orbit camera (see camera-3d.ts). */
export const TOP_DOWN_AZIMUTH = 0;

const HALF_FOV_TAN = Math.tan((DEFAULT_FOV_DEGREES * Math.PI) / 360);

/** Smoothstep: monotonic, exact at 0 and 1, zero slope at both ends so there is no jolt. */
export function easeInOut(t: number): number {
  if (!(t > 0)) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

/** Eased progress 0..1 for a tween that started `elapsedMs` ago. A zero duration is instant. */
export function tweenProgress(elapsedMs: number, durationMs: number): number {
  const d = Math.min(Math.max(durationMs, 0), MAX_TWEEN_MS);
  if (d === 0) return 1;
  return easeInOut(elapsedMs / d);
}

/** Top-down orbit showing the same focus and ground extent as a 2D view. */
export function view2dToOrbit(view: View2D, viewportHeightPx: number): Orbit3D {
  const visibleCells = Math.max(1, viewportHeightPx) / clampZoom(view.zoom);
  return {
    targetX: view.centerX,
    targetY: GROUND_EPSILON,
    targetZ: view.centerZ,
    azimuth: TOP_DOWN_AZIMUTH,
    polar: MIN_POLAR,
    distance: visibleCells / (2 * HALF_FOV_TAN),
  };
}

/** Inverse of view2dToOrbit: the 2D framing that matches an orbit's focus and distance. */
export function orbitToView2d(orbit: Orbit3D, viewportHeightPx: number): View2D {
  const visibleCells = 2 * Math.max(orbit.distance, 1e-6) * HALF_FOV_TAN;
  return {
    centerX: orbit.targetX,
    centerZ: orbit.targetZ,
    zoom: clampZoom(Math.max(1, viewportHeightPx) / visibleCells),
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Interpolate two orbits; azimuth takes the short way round. Endpoints are returned exactly. */
export function lerpOrbit(a: Orbit3D, b: Orbit3D, t: number): Orbit3D {
  if (!(t > 0)) return a;
  if (t >= 1) return b;
  const dAz = normalizeAngle(b.azimuth - a.azimuth);
  return {
    targetX: lerp(a.targetX, b.targetX, t),
    targetY: lerp(a.targetY, b.targetY, t),
    targetZ: lerp(a.targetZ, b.targetZ, t),
    azimuth: normalizeAngle(a.azimuth + dAz * t),
    polar: lerp(a.polar, b.polar, t),
    // Geometric in distance so the apparent zoom changes at a steady rate.
    distance: a.distance * Math.pow(b.distance / a.distance, t),
  };
}
