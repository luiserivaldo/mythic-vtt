import type { AoEShape, Grid, Quat, Vec3 } from '../schema/index.js';
import { UnsupportedGridError } from './snap-to-grid.js';

export type AoEInclusion = 'center' | 'any-overlap';

interface BaseAoE {
  position: Vec3;
  rotation?: Quat;
}

// MEAS-03: dimensions are finite, non-negative cells and rotation is a unit
// quaternion. The cone and line extend along local +Z from position; the
// cylinder and cube are centred on position.
type GeometryShape<T> = T extends AoEShape ? Omit<T, 'color'> : never;
export type AoE = BaseAoE & GeometryShape<AoEShape>;

export type AoECell = Vec3;

export interface AoEToken {
  id: string;
  position: Vec3; // centre of footprint at base
  sizeCells: number;
  heightCells: number;
}

const EPSILON = 1e-9;
const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (v: Vec3, n: number): Vec3 => ({ x: v.x * n, y: v.y * n, z: v.z * n });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const norm2 = (v: Vec3): number => dot(v, v);
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

const rotate = (v: Vec3, q: Quat): Vec3 => {
  const u = { x: q.x, y: q.y, z: q.z };
  const t = scale(cross(u, v), 2);
  return add(v, add(scale(t, q.w), cross(u, t)));
};

const localDirection = (v: Vec3, q: Quat): Vec3 => rotate(v, { x: -q.x, y: -q.y, z: -q.z, w: q.w });

const support = (aoe: AoE, direction: Vec3): Vec3 => {
  const d = localDirection(direction, aoe.rotation ?? IDENTITY);
  let local: Vec3;
  switch (aoe.kind) {
    case 'sphere': {
      const length = Math.sqrt(norm2(d));
      local = length > 0 ? scale(d, aoe.radius / length) : { x: 0, y: 0, z: 0 };
      break;
    }
    case 'cylinder': {
      const horizontal = Math.hypot(d.x, d.z);
      local = {
        x: horizontal > 0 ? (d.x * aoe.radius) / horizontal : 0,
        y: d.y >= 0 ? aoe.height / 2 : -aoe.height / 2,
        z: horizontal > 0 ? (d.z * aoe.radius) / horizontal : 0,
      };
      break;
    }
    case 'cone': {
      const horizontal = Math.hypot(d.x, d.y);
      const radius = aoe.length > 0 ? aoe.radius : 0;
      const rimScore = radius * horizontal + aoe.length * d.z;
      local =
        rimScore > 0
          ? {
              x: horizontal > 0 ? (radius * d.x) / horizontal : 0,
              y: horizontal > 0 ? (radius * d.y) / horizontal : 0,
              z: aoe.length,
            }
          : { x: 0, y: 0, z: 0 };
      break;
    }
    case 'cube':
      local = {
        x: (Math.sign(d.x) * aoe.size) / 2,
        y: (Math.sign(d.y) * aoe.size) / 2,
        z: (Math.sign(d.z) * aoe.size) / 2,
      };
      break;
    case 'line':
      local = {
        x: (Math.sign(d.x) * aoe.width) / 2,
        y: (Math.sign(d.y) * aoe.height) / 2,
        z: d.z >= 0 ? aoe.length : 0,
      };
      break;
  }
  return add(aoe.position, rotate(local, aoe.rotation ?? IDENTITY));
};

const inside = (aoe: AoE, point: Vec3): boolean => {
  const p = localDirection(sub(point, aoe.position), aoe.rotation ?? IDENTITY);
  switch (aoe.kind) {
    case 'sphere':
      return norm2(p) <= aoe.radius ** 2 + EPSILON;
    case 'cylinder':
      return (
        p.x ** 2 + p.z ** 2 <= aoe.radius ** 2 + EPSILON &&
        Math.abs(p.y) <= aoe.height / 2 + EPSILON
      );
    case 'cone':
      return (
        p.z >= -EPSILON &&
        p.z <= aoe.length + EPSILON &&
        p.x ** 2 + p.y ** 2 <= (aoe.length > 0 ? (aoe.radius * p.z) / aoe.length : 0) ** 2 + EPSILON
      );
    case 'cube':
      return (
        Math.abs(p.x) <= aoe.size / 2 + EPSILON &&
        Math.abs(p.y) <= aoe.size / 2 + EPSILON &&
        Math.abs(p.z) <= aoe.size / 2 + EPSILON
      );
    case 'line':
      return (
        Math.abs(p.x) <= aoe.width / 2 + EPSILON &&
        Math.abs(p.y) <= aoe.height / 2 + EPSILON &&
        p.z >= -EPSILON &&
        p.z <= aoe.length + EPSILON
      );
  }
};

interface Box {
  min: Vec3;
  max: Vec3;
}
const boxSupport = (box: Box, d: Vec3): Vec3 => ({
  x: d.x >= 0 ? box.max.x : box.min.x,
  y: d.y >= 0 ? box.max.y : box.min.y,
  z: d.z >= 0 ? box.max.z : box.min.z,
});

const closestSegment = (a: Vec3, b: Vec3): Vec3 => {
  const ab = sub(b, a);
  if (norm2(ab) <= EPSILON * EPSILON) return a;
  const t = Math.max(0, Math.min(1, -dot(a, ab) / norm2(ab)));
  return add(a, scale(ab, t));
};

const closestTriangle = (a: Vec3, b: Vec3, c: Vec3): Vec3 => {
  const ab = sub(b, a),
    ac = sub(c, a),
    ap = scale(a, -1);
  const d1 = dot(ab, ap),
    d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = scale(b, -1),
    d3 = dot(ab, bp),
    d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return add(a, scale(ab, d1 / (d1 - d3)));
  const cp = scale(c, -1),
    d5 = dot(ab, cp),
    d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return add(a, scale(ac, d2 / (d2 - d6)));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0)
    return add(b, scale(sub(c, b), (d4 - d3) / (d4 - d3 + d5 - d6)));
  const denom = va + vb + vc;
  if (Math.abs(denom) <= EPSILON) {
    const points = [closestSegment(a, b), closestSegment(a, c), closestSegment(b, c)];
    return points.reduce((best, p) => (norm2(p) < norm2(best) ? p : best));
  }
  return add(a, add(scale(ab, vb / denom), scale(ac, vc / denom)));
};

const closestSimplex = (points: Vec3[]): { point: Vec3; active: Vec3[] } => {
  const [a, b, c, d] = points;
  if (a && b && c && d) {
    const volume = dot(cross(sub(b, a), sub(c, a)), sub(d, a));
    const faces: [Vec3, Vec3, Vec3, Vec3][] = [
      [a, b, c, d],
      [a, b, d, c],
      [a, c, d, b],
      [b, c, d, a],
    ];
    const outside = faces.filter(([p, q, r, opposite]) => {
      const normal = cross(sub(q, p), sub(r, p));
      return dot(normal, scale(p, -1)) * dot(normal, sub(opposite, p)) < -EPSILON;
    });
    if (Math.abs(volume) > EPSILON && outside.length === 0)
      return { point: { x: 0, y: 0, z: 0 }, active: points };
    if (Math.abs(volume) <= EPSILON) outside.push(...faces);
    let best: { point: Vec3; active: Vec3[] } | undefined;
    for (const [p, q, r] of outside) {
      const candidate = closestTriangle(p, q, r);
      if (!best || norm2(candidate) < norm2(best.point))
        best = { point: candidate, active: [p, q, r] };
    }
    if (best) return best;
  }
  let best: { point: Vec3; active: Vec3[] } = {
    point: a ?? { x: 0, y: 0, z: 0 },
    active: a ? [a] : [],
  };
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!p) continue;
    if (norm2(p) < norm2(best.point)) best = { point: p, active: [p] };
    for (let j = i + 1; j < points.length; j++) {
      const q = points[j];
      if (!q) continue;
      const segment = closestSegment(p, q);
      if (norm2(segment) < norm2(best.point)) best = { point: segment, active: [p, q] };
      for (let k = j + 1; k < points.length; k++) {
        const r = points[k];
        if (!r) continue;
        const triangle = closestTriangle(p, q, r);
        if (norm2(triangle) < norm2(best.point)) best = { point: triangle, active: [p, q, r] };
      }
    }
  }
  return best;
};

const overlaps = (aoe: AoE, box: Box): boolean => {
  if (aoe.kind === 'sphere') {
    const dx = Math.max(box.min.x - aoe.position.x, 0, aoe.position.x - box.max.x);
    const dy = Math.max(box.min.y - aoe.position.y, 0, aoe.position.y - box.max.y);
    const dz = Math.max(box.min.z - aoe.position.z, 0, aoe.position.z - box.max.z);
    return dx * dx + dy * dy + dz * dz <= aoe.radius * aoe.radius + EPSILON;
  }
  const center = scale(add(box.min, box.max), 0.5);
  let direction = sub(center, aoe.position);
  if (norm2(direction) === 0) direction = { x: 1, y: 0, z: 0 };
  let points: Vec3[] = [];
  let closest: Vec3 = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < 32; i++) {
    const point = sub(support(aoe, direction), boxSupport(box, scale(direction, -1)));
    if (i > 0 && dot(point, direction) - dot(closest, direction) < EPSILON) return false;
    points.push(point);
    const nearest = closestSimplex(points);
    closest = nearest.point;
    if (norm2(closest) <= EPSILON * EPSILON) return true;
    direction = scale(closest, -1);
    points = nearest.active;
  }
  return norm2(closest) <= EPSILON * EPSILON;
};

const affected = (aoe: AoE, center: Vec3, box: Box, inclusion: AoEInclusion): boolean =>
  inclusion === 'center' ? inside(aoe, center) : overlaps(aoe, box);

export const cellsInAoE = (
  aoe: AoE,
  grid: Pick<Grid, 'type'>,
  inclusion: AoEInclusion = 'center',
): AoECell[] => {
  if (grid.type !== 'square') throw new UnsupportedGridError(grid.type);
  const x = { x: 1, y: 0, z: 0 },
    y = { x: 0, y: 1, z: 0 },
    z = { x: 0, y: 0, z: 1 };
  const min = {
    x: support(aoe, scale(x, -1)).x,
    y: support(aoe, scale(y, -1)).y,
    z: support(aoe, scale(z, -1)).z,
  };
  const max = { x: support(aoe, x).x, y: support(aoe, y).y, z: support(aoe, z).z };
  const result: AoECell[] = [];
  for (let cy = Math.floor(min.y) - 1; cy <= Math.floor(max.y) + 1; cy++) {
    for (let cz = Math.floor(min.z) - 1; cz <= Math.floor(max.z) + 1; cz++) {
      for (let cx = Math.floor(min.x) - 1; cx <= Math.floor(max.x) + 1; cx++) {
        const cell = { x: cx, y: cy, z: cz };
        const center = { x: cx + 0.5, y: cy + 0.5, z: cz + 0.5 };
        const box = { min: cell, max: { x: cx + 1, y: cy + 1, z: cz + 1 } };
        if (affected(aoe, center, box, inclusion)) result.push(cell);
      }
    }
  }
  return result;
};

export const tokensInAoE = <T extends AoEToken>(
  aoe: AoE,
  tokens: readonly T[],
  inclusion: AoEInclusion = 'center',
): T[] =>
  tokens.filter((token) => {
    const half = token.sizeCells / 2;
    const box = {
      min: { x: token.position.x - half, y: token.position.y, z: token.position.z - half },
      max: {
        x: token.position.x + half,
        y: token.position.y + token.heightCells,
        z: token.position.z + half,
      },
    };
    return affected(aoe, token.position, box, inclusion);
  });
