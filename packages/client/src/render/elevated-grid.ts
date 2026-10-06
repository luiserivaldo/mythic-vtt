import { primitiveFootprint, primitiveProfileHeight, type Point2 } from '@mythic/shared';
import { MAX_LINES_PER_AXIS } from './grid-lines.js';
import type { RenderShape } from './scene-model.js';

/** Small world-Y separation from the primitive surface, preventing coplanar z-fighting. */
export const ELEVATED_GRID_LIFT = 0.003;

export type ElevatedGridShape = Pick<
  RenderShape,
  'kind' | 'width' | 'height' | 'depth' | 'yaw' | 'scale'
>;

export function supportsElevatedGrid(kind: RenderShape['kind']): boolean {
  return kind === 'box' || kind === 'plane' || kind === 'cylinder' || kind === 'wedge';
}

function polygonSpan(
  points: readonly Point2[],
  axis: 'x' | 'z',
  value: number,
): readonly [number, number] | null {
  const along = axis === 'x' ? 'z' : 'x';
  const hits: number[] = [];
  for (let index = 0; index < points.length; index++) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    if (!a || !b) continue;
    const av = a[axis];
    const bv = b[axis];
    const delta = bv - av;
    if (Math.abs(delta) < 1e-9) {
      if (Math.abs(value - av) < 1e-9) hits.push(a[along], b[along]);
      continue;
    }
    const t = (value - av) / delta;
    if (t >= -1e-9 && t <= 1 + 1e-9) hits.push(a[along] + (b[along] - a[along]) * t);
  }
  if (hits.length < 2) return null;
  return [Math.min(...hits), Math.max(...hits)];
}

function quadraticSpan(
  constantDelta: number,
  halfConstant: number,
  halfAlong: number,
  constantRotation: number,
  alongRotation: number,
  centreAlong: number,
): readonly [number, number] | null {
  const u0 = constantRotation * constantDelta;
  const v0 = alongRotation * constantDelta;
  const du = -alongRotation;
  const dv = constantRotation;
  const a = (du * du) / (halfConstant * halfConstant) + (dv * dv) / (halfAlong * halfAlong);
  const b = (2 * u0 * du) / (halfConstant * halfConstant) + (2 * v0 * dv) / (halfAlong * halfAlong);
  const c = (u0 * u0) / (halfConstant * halfConstant) + (v0 * v0) / (halfAlong * halfAlong) - 1;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < -1e-9) return null;
  const root = Math.sqrt(Math.max(discriminant, 0));
  const first = (-b - root) / (2 * a) + centreAlong;
  const second = (-b + root) / (2 * a) + centreAlong;
  return first <= second ? [first, second] : [second, first];
}

function ellipseSpan(
  shape: ElevatedGridShape,
  position: readonly [number, number, number],
  axis: 'x' | 'z',
  value: number,
): readonly [number, number] | null {
  const [cx, , cz] = position;
  const cosine = Math.cos(shape.yaw);
  const sine = Math.sin(shape.yaw);
  if (axis === 'x') {
    return quadraticSpan(value - cx, shape.width / 2, shape.depth / 2, cosine, sine, cz);
  }
  // Swapping world axes changes the local coefficients to u=-sin(z-cz)+cos(x-cx),
  // v=cos(z-cz)+sin(x-cx).
  return quadraticSpan(value - cz, shape.depth / 2, shape.width / 2, cosine, -sine, cx);
}

function surfaceY(
  shape: ElevatedGridShape,
  position: readonly [number, number, number],
  x: number,
  z: number,
): number | null {
  const height = primitiveProfileHeight(
    {
      kind: shape.kind,
      position: { x: position[0], y: position[1], z: position[2] },
      scale: shape.scale,
      yaw: shape.yaw,
    },
    x,
    z,
  );
  return height === undefined ? null : position[1] + height + ELEVATED_GRID_LIFT;
}

function appendSegment(
  out: number[],
  shape: ElevatedGridShape,
  position: readonly [number, number, number],
  x1: number,
  z1: number,
  x2: number,
  z2: number,
): void {
  const y1 = surfaceY(shape, position, x1, z1);
  const y2 = surfaceY(shape, position, x2, z2);
  if (y1 === null || y2 === null || Math.hypot(x2 - x1, z2 - z1) < 1e-9) return;
  out.push(x1, y1, z1, x2, y2, z2);
}

/**
 * GRID-05: world-aligned square-grid segments clipped to one planar primitive top.
 * Box/plane/wedge footprints are rectangles; cylinder tops use the exact rotated ellipse.
 */
export function elevatedGridSegments(
  shape: ElevatedGridShape,
  position: readonly [number, number, number],
): Float32Array {
  if (!supportsElevatedGrid(shape.kind)) return new Float32Array(0);
  const [cx, , cz] = position;
  const footprint = primitiveFootprint(shape.kind, shape.scale, shape.yaw).map((point) => ({
    x: point.x + cx,
    z: point.z + cz,
  }));
  const minX = Math.ceil(Math.min(...footprint.map((point) => point.x)) - 1e-9);
  const maxX = Math.floor(Math.max(...footprint.map((point) => point.x)) + 1e-9);
  const minZ = Math.ceil(Math.min(...footprint.map((point) => point.z)) - 1e-9);
  const maxZ = Math.floor(Math.max(...footprint.map((point) => point.z)) + 1e-9);
  if (maxX - minX + 1 > MAX_LINES_PER_AXIS || maxZ - minZ + 1 > MAX_LINES_PER_AXIS)
    return new Float32Array(0);

  const out: number[] = [];
  for (let x = minX; x <= maxX; x++) {
    const span =
      shape.kind === 'cylinder'
        ? ellipseSpan(shape, position, 'x', x)
        : polygonSpan(footprint, 'x', x);
    if (span) appendSegment(out, shape, position, x, span[0], x, span[1]);
  }
  for (let z = minZ; z <= maxZ; z++) {
    const span =
      shape.kind === 'cylinder'
        ? ellipseSpan(shape, position, 'z', z)
        : polygonSpan(footprint, 'z', z);
    if (span) appendSegment(out, shape, position, span[0], z, span[1], z);
  }
  return new Float32Array(out);
}
