/** A point on the board plane (world X, world Z), or in an entity's local XZ frame. */
export interface PointXZ {
  x: number;
  z: number;
}

function orientation(a: PointXZ, b: PointXZ, c: PointXZ): number {
  const value = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  return value > 0 ? 1 : value < 0 ? -1 : 0;
}

function onSegment(a: PointXZ, b: PointXZ, p: PointXZ): boolean {
  return (
    Math.min(a.x, b.x) <= p.x &&
    p.x <= Math.max(a.x, b.x) &&
    Math.min(a.z, b.z) <= p.z &&
    p.z <= Math.max(a.z, b.z)
  );
}

/** Do the closed segments ab and cd share at least one point (touching counts)? */
export function segmentsIntersect(a: PointXZ, b: PointXZ, c: PointXZ, d: PointXZ): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  return (
    (o1 === 0 && onSegment(a, b, c)) ||
    (o2 === 0 && onSegment(a, b, d)) ||
    (o3 === 0 && onSegment(c, d, a)) ||
    (o4 === 0 && onSegment(c, d, b))
  );
}

/**
 * FOG-01 (MV-295): is this closed ring a simple polygon? At least three distinct, non-collinear
 * vertices, and no edge touches another except its two neighbours at their shared vertex. O(n²),
 * which is fine for the 64-point cap on fog regions.
 */
export function isSimplePolygon(points: readonly PointXZ[]): boolean {
  const n = points.length;
  if (n < 3) return false;
  const at = (i: number): PointXZ => points[i % n] as PointXZ;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = at(i);
    const b = at(i + 1);
    if (a.x === b.x && a.z === b.z) return false;
    area += a.x * b.z - b.x * a.z;
  }
  if (area === 0) return false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) {
        // Neighbours share one vertex; folding back onto each other is still a self-overlap.
        const [p, shared, q] = j === i + 1 ? [at(i), at(j), at(j + 1)] : [at(j), at(0), at(1)];
        if (orientation(p, shared, q) === 0 && (onSegment(p, shared, q) || onSegment(shared, q, p)))
          return false;
        continue;
      }
      if (segmentsIntersect(at(i), at(i + 1), at(j), at(j + 1))) return false;
    }
  }
  return true;
}

/**
 * FOG-01 (D47): wall and fog-region points live in the entity's local XZ frame. World = position
 * plus the point rotated by the entity's yaw, in the same sense as `primitiveFootprint` (three.js
 * rotation about +Y). Scale is ignored, so resizing a wall entity never moves its points.
 */
export function localToWorldXZ(
  position: { x: number; z: number },
  yaw: number,
  point: PointXZ,
): PointXZ {
  if (yaw === 0) return { x: position.x + point.x, z: position.z + point.z };
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: position.x + c * point.x + s * point.z, z: position.z - s * point.x + c * point.z };
}
