/**
 * Pure 3D orbit camera maths (CAM-02). No DOM or Three.js.
 *
 * Y-up world (§6.2): grid X -> world X, grid Y -> world Z, elevation -> world Y.
 * The camera is stored as spherical coordinates around a focus point, which makes
 * roll impossible by construction: the up vector is always world +Y and the only
 * degrees of freedom are azimuth, polar (tilt from vertical), distance and target.
 * Using lookAt(target) with up=+Y therefore never flips (Unity prototype lesson).
 */

export interface Orbit3D {
  /** Focus point on or above the ground plane. */
  targetX: number;
  targetY: number;
  targetZ: number;
  /** Rotation about world Y in radians, free, normalised to (-PI, PI]. */
  azimuth: number;
  /** Angle from straight-down (+Y) in radians, clamped to [MIN_POLAR, MAX_POLAR]. */
  polar: number;
  /** Camera distance from the focus point in world units (cells). */
  distance: number;
}

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}
export interface Point {
  x: number;
  y: number;
}
export interface GroundBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export type CameraPointerMode = 'orbit' | 'pan';

const DEG = Math.PI / 180;
export const MIN_POLAR = 5 * DEG;
export const MAX_POLAR = 85 * DEG;
export const MIN_DISTANCE = 2;
export const MAX_DISTANCE = 400;
/** The camera and focus never go below this height above the ground plane (y = 0). */
export const GROUND_EPSILON = 0.05;
/** Sanity bound on pan so a runaway gesture cannot fly the focus to infinity. */
export const MAX_PAN_EXTENT = 10_000;
/** M2-12: a wider lens makes depth legible instead of flattening the board. */
export const DEFAULT_FOV_DEGREES = 60;
/** Small edge allowance without pulling back far enough to flatten the scene again. */
export const DEFAULT_FRAME_PADDING = 1.04;
export const DEFAULT_AZIMUTH = Math.PI / 4;
export const DEFAULT_POLAR = 55 * DEG;
/** Radians of rotation per pixel dragged. */
export const ROTATE_SPEED = 0.006;

/** M2-15: conventional 3D mouse mapping; tools may reserve left-drag for themselves. */
export function cameraPointerMode(
  pointerType: string,
  button: number,
  leftPanEnabled: boolean,
): CameraPointerMode | null {
  if (pointerType !== 'mouse') return 'orbit';
  if (button === 2) return 'orbit';
  if (button === 1 || (button === 0 && leftPanEnabled)) return 'pan';
  return null;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const finiteOr = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback);

export function normalizeAngle(a: number): number {
  if (!Number.isFinite(a)) return 0;
  const twoPi = Math.PI * 2;
  let r = a % twoPi;
  if (r > Math.PI) r -= twoPi;
  else if (r <= -Math.PI) r += twoPi;
  return r;
}

/** Offset of the camera from its focus point. */
export function orbitOffset(o: Pick<Orbit3D, 'azimuth' | 'polar' | 'distance'>): Vec3Like {
  const s = Math.sin(o.polar);
  return {
    x: o.distance * s * Math.sin(o.azimuth),
    y: o.distance * Math.cos(o.polar),
    z: o.distance * s * Math.cos(o.azimuth),
  };
}

export function orbitPosition(o: Orbit3D): Vec3Like {
  const off = orbitOffset(o);
  return { x: o.targetX + off.x, y: o.targetY + off.y, z: o.targetZ + off.z };
}

/** The camera up vector. Constant by design: there is no roll state. */
export const WORLD_UP: Readonly<Vec3Like> = Object.freeze({ x: 0, y: 1, z: 0 });

/** Inverse of orbitPosition, used to adopt an existing camera pose. */
export function orbitFromPositionTarget(position: Vec3Like, target: Vec3Like): Orbit3D {
  const dx = position.x - target.x;
  const dy = position.y - target.y;
  const dz = position.z - target.z;
  const distance = Math.hypot(dx, dy, dz) || MIN_DISTANCE;
  return clampOrbit({
    targetX: target.x,
    targetY: target.y,
    targetZ: target.z,
    azimuth: Math.atan2(dx, dz),
    polar: Math.acos(clamp(dy / distance, -1, 1)),
    distance,
  });
}

/** Enforce every invariant: tilt range, distance bounds, focus above ground, camera above ground. */
export function clampOrbit(o: Orbit3D): Orbit3D {
  const targetX = clamp(finiteOr(o.targetX, 0), -MAX_PAN_EXTENT, MAX_PAN_EXTENT);
  const targetZ = clamp(finiteOr(o.targetZ, 0), -MAX_PAN_EXTENT, MAX_PAN_EXTENT);
  const targetY = clamp(finiteOr(o.targetY, 0), GROUND_EPSILON, MAX_PAN_EXTENT);
  const distance = clamp(finiteOr(o.distance, MIN_DISTANCE * 4), MIN_DISTANCE, MAX_DISTANCE);
  const polar = clamp(finiteOr(o.polar, DEFAULT_POLAR), MIN_POLAR, MAX_POLAR);
  // With target.y >= epsilon and polar <= 85deg the camera is already above the ground; this
  // is a belt-and-braces guard should the constants ever change.
  const minHeight = GROUND_EPSILON;
  const height = targetY + distance * Math.cos(polar);
  const safePolar =
    height >= minHeight ? polar : Math.acos(clamp((minHeight - targetY) / distance, -1, 1));
  return {
    targetX,
    targetY,
    targetZ,
    azimuth: normalizeAngle(finiteOr(o.azimuth, DEFAULT_AZIMUTH)),
    polar: clamp(safePolar, MIN_POLAR, MAX_POLAR),
    distance,
  };
}

/** Orbit by a pixel drag. Dragging right swings the camera left around the focus; down raises it. */
export function orbitByPixels(o: Orbit3D, dxPx: number, dyPx: number): Orbit3D {
  return clampOrbit({
    ...o,
    azimuth: o.azimuth - dxPx * ROTATE_SPEED,
    polar: o.polar - dyPx * ROTATE_SPEED,
  });
}

/** Unit ground-plane vectors for screen-right and screen-up at the given azimuth. */
export function groundAxes(azimuth: number): { right: Point; forward: Point } {
  return {
    right: { x: Math.cos(azimuth), y: -Math.sin(azimuth) },
    forward: { x: -Math.sin(azimuth), y: -Math.cos(azimuth) },
  };
}

/** World units covered by one screen pixel at the focus distance. */
export function worldPerPixel(distance: number, viewportHeightPx: number): number {
  const h = Math.max(1, viewportHeightPx);
  return (2 * distance * Math.tan((DEFAULT_FOV_DEGREES * DEG) / 2)) / h;
}

/**
 * Pan the focus along the ground plane so the content follows the pointer. The focus height
 * is untouched. Depth foreshortening is compensated but capped so near-horizontal views stay
 * controllable.
 */
export function panOnGround(
  o: Orbit3D,
  dxPx: number,
  dyPx: number,
  viewportHeightPx: number,
): Orbit3D {
  const k = worldPerPixel(o.distance, viewportHeightPx);
  const depth = k / Math.max(Math.cos(o.polar), 1 / 3);
  const { right, forward } = groundAxes(o.azimuth);
  return clampOrbit({
    ...o,
    targetX: o.targetX - right.x * dxPx * k + forward.x * dyPx * depth,
    targetZ: o.targetZ - right.y * dxPx * k + forward.y * dyPx * depth,
  });
}

/** Dolly by a multiplicative factor (>1 moves away). */
export function dolly(o: Orbit3D, factor: number): Orbit3D {
  if (!Number.isFinite(factor) || factor <= 0) return o;
  return clampOrbit({ ...o, distance: o.distance * factor });
}

export function wheelFactor(e: { deltaY: number; deltaMode: number; ctrlKey?: boolean }): number {
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
  // ctrl+wheel is a trackpad pinch: it reports small deltas, so amplify.
  const speed = e.ctrlKey ? 0.01 : 0.0015;
  return Math.exp(clamp(e.deltaY * unit, -400, 400) * speed);
}

/** Two-finger gesture: pinch changes distance, midpoint motion pans. */
export function pinchUpdate(
  o: Orbit3D,
  viewportHeightPx: number,
  before: readonly [Point, Point],
  after: readonly [Point, Point],
): Orbit3D {
  const d0 = Math.hypot(before[0].x - before[1].x, before[0].y - before[1].y);
  const d1 = Math.hypot(after[0].x - after[1].x, after[0].y - after[1].y);
  let next = d0 > 1 && d1 > 1 ? dolly(o, d0 / d1) : o;
  const mx = (after[0].x + after[1].x) / 2 - (before[0].x + before[1].x) / 2;
  const my = (after[0].y + after[1].y) / 2 - (before[0].y + before[1].y) / 2;
  next = panOnGround(next, mx, my, viewportHeightPx);
  return next;
}

/** D37: keep the orbit focus on the canvas. Null (no scene) leaves the focus alone. */
export function clampTargetToGround(o: Orbit3D, ground: GroundBounds | null): Orbit3D {
  if (!ground) return o;
  return {
    ...o,
    targetX: clamp(o.targetX, ground.minX, ground.maxX),
    targetZ: clamp(o.targetZ, ground.minZ, ground.maxZ),
  };
}

/**
 * Nearest distance from which the default camera contains every canvas corner. The calculation
 * accounts for perspective depth and the viewport aspect ratio instead of framing a padded
 * bounding circle, which used to pull the camera unnecessarily far back.
 */
export function distanceToFrameGround(bounds: GroundBounds, aspectRatio = 1): number {
  const aspect = Math.max(finiteOr(aspectRatio, 1), 1e-3);
  const tanVertical = Math.tan((DEFAULT_FOV_DEGREES * DEG) / 2);
  const tanHorizontal = tanVertical * aspect;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const sinAzimuth = Math.sin(DEFAULT_AZIMUTH);
  const cosAzimuth = Math.cos(DEFAULT_AZIMUTH);
  const sinPolar = Math.sin(DEFAULT_POLAR);
  const cosPolar = Math.cos(DEFAULT_POLAR);
  let distance = MIN_DISTANCE;

  for (const x of [bounds.minX, bounds.maxX]) {
    for (const z of [bounds.minZ, bounds.maxZ]) {
      const dx = x - cx;
      const dz = z - cz;
      const alongGround = dx * sinAzimuth + dz * cosAzimuth;
      const depthOffset = sinPolar * alongGround;
      const cameraX = dx * cosAzimuth - dz * sinAzimuth;
      const cameraY = -cosPolar * alongGround;
      distance = Math.max(
        distance,
        depthOffset + Math.abs(cameraX) / tanHorizontal,
        depthOffset + Math.abs(cameraY) / tanVertical,
      );
    }
  }
  return distance * DEFAULT_FRAME_PADDING;
}

/** Default isometric-ish view framing the given ground bounds (or a 20x20 area when empty). */
export function defaultOrbit(bounds: GroundBounds | null, aspectRatio = 1): Orbit3D {
  const b = bounds ?? { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  return clampOrbit({
    targetX: cx,
    targetY: GROUND_EPSILON,
    targetZ: cz,
    azimuth: DEFAULT_AZIMUTH,
    polar: DEFAULT_POLAR,
    distance: distanceToFrameGround(b, aspectRatio),
  });
}

/** Exponential damping of rotation velocity (rad/s). Returns 0 once negligible. */
export function dampVelocity(v: number, dtSeconds: number): number {
  const next = v * Math.exp(-dtSeconds * 8);
  return Math.abs(next) < 0.01 ? 0 : next;
}
