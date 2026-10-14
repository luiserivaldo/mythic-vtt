import type { Entity } from '../schema/index.js';

// ENV-02. Pure builders for primitive shapes. Convention: Y-up, 1 unit = 1 cell,
// the entity position is the footprint centre at the base, `transform.scale` is the bounding size
// (x = width, y = height, z = depth) in cells, and rotation is a yaw about Y.

export type PrimitiveKind = NonNullable<Entity['shape']>['kind'];

export const PRIMITIVE_KINDS: readonly PrimitiveKind[] = [
  'box',
  'cylinder',
  'cone',
  'pyramid',
  'sphere',
  'plane',
  'wedge',
];

/** A plane is a flat walkable surface, so its thickness is fixed rather than taken from scale. */
export const PLANE_THICKNESS = 0.02;
/** Segments used to approximate round footprints. Even, so the outline is symmetric. */
export const ROUND_FOOTPRINT_SEGMENTS = 32;

export interface PrimitiveDimensions {
  width: number;
  height: number;
  depth: number;
}

export interface Point2 {
  x: number;
  z: number;
}

const MIN_EXTENT = 1e-4;
const extent = (value: number) => Math.max(Math.abs(value), MIN_EXTENT);

/** Bounding dimensions in cells. Degenerate or negative scales are clamped, never NaN. */
export function primitiveDimensions(
  kind: PrimitiveKind,
  scale: { x: number; y: number; z: number },
): PrimitiveDimensions {
  return {
    width: extent(scale.x),
    height: kind === 'plane' ? PLANE_THICKNESS : extent(scale.y),
    depth: extent(scale.z),
  };
}

/** Top surface elevation above the base: the walkable height (ENV-04). Ramps and cones slope. */
export function primitiveTopHeight(kind: PrimitiveKind, height: number): number {
  return kind === 'plane' ? PLANE_THICKNESS : Math.abs(height);
}

/** Yaw (radians, about Y) of a quaternion; pitch and roll are ignored for footprints. */
export function yawFromQuaternion(q: { x: number; y: number; z: number; w: number }): number {
  return Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
}

function rotate(points: Point2[], yaw: number): Point2[] {
  if (yaw === 0) return points;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // Same sense as three.js rotation about +Y: x' = c*x + s*z, z' = -s*x + c*z.
  return points.map((p) => ({ x: c * p.x + s * p.z, z: -s * p.x + c * p.z }));
}

/**
 * Convex top-down outline, relative to the footprint centre, ordered consistently.
 * Round kinds (cylinder, cone, sphere) become an ellipse polygon. Everything else is the
 * bounding rectangle: a pyramid and wedge cover their whole box at the base.
 */
export function primitiveFootprint(
  kind: PrimitiveKind,
  scale: { x: number; y: number; z: number },
  yaw = 0,
): Point2[] {
  const { width, depth } = primitiveDimensions(kind, scale);
  const hx = width / 2;
  const hz = depth / 2;
  if (kind === 'cylinder' || kind === 'cone' || kind === 'sphere') {
    const points: Point2[] = [];
    for (let i = 0; i < ROUND_FOOTPRINT_SEGMENTS; i++) {
      const a = (i / ROUND_FOOTPRINT_SEGMENTS) * Math.PI * 2;
      points.push({ x: Math.cos(a) * hx, z: Math.sin(a) * hz });
    }
    return rotate(points, yaw);
  }
  return rotate(
    [
      { x: -hx, z: -hz },
      { x: hx, z: -hz },
      { x: hx, z: hz },
      { x: -hx, z: hz },
    ],
    yaw,
  );
}

/** Axis-aligned world bounds of the (rotated) footprint around a centre. */
export function footprintBounds(points: readonly Point2[]): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  return { minX, maxX, minZ, maxZ };
}

export interface WedgeMesh {
  /** Flat xyz triples, centred on the footprint with the base at y = 0. */
  positions: number[];
  /** Triangle indices, counter-clockwise seen from outside. */
  indices: number[];
}

/**
 * A wedge (ramp) is a triangular prism: the slope rises from y = 0 at -z (low edge) to
 * `height` at +z (high edge); the +z face is vertical.
 */
export function wedgeMesh(width: number, height: number, depth: number): WedgeMesh {
  const hx = width / 2;
  const hz = depth / 2;
  // 0,1: low edge (bottom, -z). 2,3: back bottom (+z). 4,5: back top (+z).
  const positions = [
    -hx,
    0,
    -hz,
    hx,
    0,
    -hz,
    hx,
    0,
    hz,
    -hx,
    0,
    hz,
    hx,
    height,
    hz,
    -hx,
    height,
    hz,
  ];
  const indices = [
    // bottom (faces down)
    0, 1, 2, 0, 2, 3,
    // sloped top
    0, 5, 4, 0, 4, 1,
    // vertical back (+z)
    3, 2, 4, 3, 4, 5,
    // sides (triangles)
    0, 3, 5, 1, 4, 2,
  ];
  return { positions, indices };
}

/** Distinct vertex count and triangle count for budgets (§6.5) and tests. */
export function wedgeTriangleCount(): number {
  return wedgeMesh(1, 1, 1).indices.length / 3;
}
