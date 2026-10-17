import type { Entity } from '../schema/index.js';
import type { Point2 } from './primitives.js';

// VIS-01, VIS-02 (D47): 2D vision on the board plane XZ (1 unit = 1 cell). Elevation is ignored.
// The host filters what each seat receives with these functions and the client draws the fog with
// the same ones, so every rule here must be deterministic and independent of input order.
//
// Determinism holds within one JS engine only: results are bit-identical for the same inputs on the
// same engine. ECMAScript leaves Math.atan2, sin and cos implementation-approximated, so two engines
// may differ by an ulp and reorder near-tied events. Host and client polygons must therefore never
// be compared or hashed against each other: the host is the authority (D47 §5), FOG-05 only draws.

export interface Segment {
  a: Point2;
  b: Point2;
}

export interface Bounds2 {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/**
 * The shared vision epsilon, in cells for distances and radians for angles. Points within it of a
 * polygon edge are on the boundary, which counts as inside everywhere.
 */
export const VISION_EPSILON = 1e-9;
const EPS = VISION_EPSILON;
const TWO_PI = Math.PI * 2;

/** Token sight samples sit this far inside its square, so a token flush against a wall is judged
 * by points on its own side of that wall. */
export const TOKEN_SAMPLE_INSET = 0.05;

/**
 * How far, in cells, an origin on a wall or the bounds edge is moved off it before the sweep (see
 * `visionOrigin`). Far above `VISION_EPSILON`, so the moved point is clearly off the walls, and far
 * below `TOKEN_SAMPLE_INSET`, so the eye stays well inside the token it belongs to.
 */
export const VISION_NUDGE = 1e-6;

/** World segments of a wall polyline given in local XZ, rotated by `yaw` (about +Y) then placed. */
export function wallSegments(points: readonly Point2[], position: Point2, yaw: number): Segment[] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // Same sense as three.js rotation about +Y (and primitiveFootprint): x' = c*x + s*z, z' = -s*x + c*z.
  const world = points.map((p) =>
    yaw === 0
      ? { x: p.x + position.x, z: p.z + position.z }
      : { x: c * p.x + s * p.z + position.x, z: -s * p.x + c * p.z + position.z },
  );
  const segments: Segment[] = [];
  for (let i = 1; i < world.length; i++) {
    segments.push({ a: world[i - 1] as Point2, b: world[i] as Point2 });
  }
  return segments;
}

/** The closed outline of a polygon (last point joins the first), e.g. a world-space footprint. */
export function polygonSegments(points: readonly Point2[]): Segment[] {
  if (points.length < 2) return [];
  return points.map((a, i) => ({ a, b: points[(i + 1) % points.length] as Point2 }));
}

/** Something that blocks sight: open segments (walls, closed doors) or a closed footprint outline. */
export type VisionOccluder =
  | { kind: 'segments'; segments: readonly Segment[] }
  | { kind: 'footprint'; outline: readonly Point2[] };

/**
 * The segments that block sight from `origin`. A footprint whose strict interior holds the origin is
 * skipped entirely, so a token standing inside a sight-blocking prop is not blind; it sees out
 * through that prop but is still blocked by everything else. An origin on the outline (within
 * `VISION_EPSILON`) is not inside: the outline stays, `visibilityPolygon` moves the origin off it
 * like off any wall, and the prop keeps blocking, so a token on a pillar's edge or corner never sees
 * through the pillar. Pass the footprint outlines to `visibilityPolygon` too, so that move goes out
 * of the prop rather than into it.
 */
export function visionOccluders(origin: Point2, occluders: readonly VisionOccluder[]): Segment[] {
  const out: Segment[] = [];
  for (const occluder of occluders) {
    if (occluder.kind === 'segments') {
      out.push(...occluder.segments);
      continue;
    }
    const outline = polygonSegments(occluder.outline);
    if (!strictlyInside(origin, occluder.outline, outline)) out.push(...outline);
  }
  return out;
}

/** Inside the footprint and farther than `VISION_EPSILON` from its outline. */
function strictlyInside(
  p: Point2,
  outline: readonly Point2[],
  edges: readonly Segment[] = polygonSegments(outline),
): boolean {
  return pointInPolygon(p, outline) && !edges.some((s) => touches(p, s));
}

/**
 * Even-odd point in polygon. A point within `VISION_EPSILON` of an edge is inside, so a sample on a
 * vision boundary is seen. Works for either winding; fewer than 3 vertices contain nothing.
 */
export function pointInPolygon(p: Point2, polygon: readonly Point2[]): boolean {
  const n = polygon.length;
  if (n < 3) return false;
  const px = p.x;
  const pz = p.z;
  let inside = false;
  let prev = polygon[n - 1] as Point2;
  for (let i = 0; i < n; i++) {
    const cur = polygon[i] as Point2;
    const ax = prev.x;
    const az = prev.z;
    const bx = cur.x;
    const bz = cur.z;
    // Boundary test first, only for edges whose box (grown by epsilon) holds the point.
    if (
      px >= Math.min(ax, bx) - EPS &&
      px <= Math.max(ax, bx) + EPS &&
      pz >= Math.min(az, bz) - EPS &&
      pz <= Math.max(az, bz) + EPS
    ) {
      const ex = bx - ax;
      const ez = bz - az;
      const len2 = ex * ex + ez * ez;
      const wx = px - ax;
      const wz = pz - az;
      if (len2 <= EPS * EPS) {
        if (wx * wx + wz * wz <= EPS * EPS) return true;
      } else {
        const t = Math.max(0, Math.min(1, (wx * ex + wz * ez) / len2));
        const dx = wx - t * ex;
        const dz = wz - t * ez;
        if (dx * dx + dz * dz <= EPS * EPS) return true;
      }
    }
    if (az > pz !== bz > pz && px < ax + ((pz - az) * (bx - ax)) / (bz - az)) inside = !inside;
    prev = cur;
  }
  return inside;
}

/** True when any sample lies inside (or on) any vision polygon. */
export function isSeen(
  polygons: readonly (readonly Point2[])[],
  samples: readonly Point2[],
): boolean {
  for (const polygon of polygons) {
    for (const sample of samples) {
      if (pointInPolygon(sample, polygon)) return true;
    }
  }
  return false;
}

export type SightEntity = Pick<Entity, 'transform' | 'token' | 'aoe' | 'pin'>;

/**
 * Points tested for "is this entity seen" (D47). A token: its centre and the four corners of its
 * `sizeCells` square inset by `TOKEN_SAMPLE_INSET`. An AoE: its centre and the eight corners of its
 * local 3D bounding box, rotated by the full rotation (yaw, pitch and roll, as geometry/aoe.ts
 * rotates the shape), placed at its position and projected to XZ; corners that project to the same
 * point are kept once. Box corners lie slightly outside spheres and cones, so those over-reveal a
 * little (accepted: a sample can only make an AoE seen early, never hide one).
 * Anything else, pins included: its position.
 */
export function sightSamples(entity: SightEntity): Point2[] {
  const { x, z } = entity.transform.position;
  const centre = { x, z };
  if (entity.token) {
    const h = entity.token.sizeCells / 2 - TOKEN_SAMPLE_INSET;
    if (!(h > 0)) return [centre];
    return [
      centre,
      { x: x - h, z: z - h },
      { x: x + h, z: z - h },
      { x: x + h, z: z + h },
      { x: x - h, z: z + h },
    ];
  }
  const box = entity.aoe ? aoeBox(entity.aoe) : undefined;
  if (!box) return [centre];
  const q = entity.transform.rotation;
  const samples: Point2[] = [centre];
  for (let corner = 0; corner < 8; corner++) {
    const v = rotateByQuaternion(
      corner & 1 ? box.max.x : box.min.x,
      corner & 2 ? box.max.y : box.min.y,
      corner & 4 ? box.max.z : box.min.z,
      q,
    );
    const sample = { x: x + v.x, z: z + v.z };
    if (!samples.some((s, i) => i > 0 && s.x === sample.x && s.z === sample.z))
      samples.push(sample);
  }
  return samples;
}

/** `v` rotated by the unit quaternion `q`: the same formula, in the same order, as aoe.ts `rotate`. */
function rotateByQuaternion(
  vx: number,
  vy: number,
  vz: number,
  q: { x: number; y: number; z: number; w: number },
): { x: number; y: number; z: number } {
  // t = 2 (u x v); v' = v + w t + u x t, with u = (q.x, q.y, q.z).
  const tx = 2 * (q.y * vz - q.z * vy);
  const ty = 2 * (q.z * vx - q.x * vz);
  const tz = 2 * (q.x * vy - q.y * vx);
  return {
    x: vx + (tx * q.w + (q.y * tz - q.z * ty)),
    y: vy + (ty * q.w + (q.z * tx - q.x * tz)),
    z: vz + (tz * q.w + (q.x * ty - q.y * tx)),
  };
}

/**
 * Local 3D bounding box of an AoE in the geometry/aoe.ts frame: the sphere, cylinder and cube are
 * centred on the position; the cone and line extend along local +Z, the cone's rim in local XY and
 * the line's height along local Y. The pre-M3 legacy component has no defined dimensions, so it
 * samples its position only.
 */
function aoeBox(
  aoe: NonNullable<Entity['aoe']>,
):
  | { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }
  | undefined {
  const box = (hx: number, hy: number, minZ: number, maxZ: number) => ({
    min: { x: -hx, y: -hy, z: minZ },
    max: { x: hx, y: hy, z: maxZ },
  });
  if ('radius' in aoe) {
    if (aoe.kind === 'cone') {
      const r = aoe.length > 0 ? aoe.radius : 0;
      return box(r, r, 0, aoe.length);
    }
    if (aoe.kind === 'cylinder') return box(aoe.radius, aoe.height / 2, -aoe.radius, aoe.radius);
    return box(aoe.radius, aoe.radius, -aoe.radius, aoe.radius);
  }
  if ('width' in aoe) return box(aoe.width / 2, aoe.height / 2, 0, aoe.length);
  if (aoe.kind === 'cube' && !('size2' in aoe)) {
    const h = aoe.size / 2;
    return box(h, h, -h, h);
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Visibility polygon

/**
 * Indices 0..n-1 ordered by `keys`, ties by index (a stable merge sort over runs sorted by
 * insertion). Specialised so the comparison is inlined: this sort is the hot spot of the sweep.
 */
function sortByKey(keys: Float64Array, n: number): Int32Array {
  let src: Int32Array = new Int32Array(n);
  let dst: Int32Array = new Int32Array(n);
  const RUN = 8;
  for (let lo = 0; lo < n; lo += RUN) {
    const hi = Math.min(lo + RUN, n);
    for (let i = lo; i < hi; i++) {
      const key = keys[i] as number;
      let j = i - 1;
      while (j >= lo && (keys[src[j] as number] as number) > key) {
        src[j + 1] = src[j] as number;
        j--;
      }
      src[j + 1] = i;
    }
  }
  for (let width = RUN; width < n; width *= 2) {
    for (let lo = 0; lo < n; lo += 2 * width) {
      const mid = Math.min(lo + width, n);
      const hi = Math.min(lo + 2 * width, n);
      let i = lo;
      let j = mid;
      let k = lo;
      while (i < mid && j < hi) {
        const p = src[i] as number;
        const q = src[j] as number;
        if ((keys[q] as number) < (keys[p] as number)) {
          dst[k++] = q;
          j++;
        } else {
          dst[k++] = p;
          i++;
        }
      }
      while (i < mid) dst[k++] = src[i++] as number;
      while (j < hi) dst[k++] = src[j++] as number;
    }
    [src, dst] = [dst, src];
  }
  return src;
}

/**
 * Liang-Barsky clip of a segment to the closed bounds, written to `out` at `at`; returns false when
 * nothing is left.
 */
function clip(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  bounds: Bounds2,
  out: Float64Array,
  at: number,
): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  let t0 = 0;
  let t1 = 1;
  for (let side = 0; side < 4; side++) {
    const p = side === 0 ? -dx : side === 1 ? dx : side === 2 ? -dz : dz;
    const q =
      side === 0
        ? ax - bounds.minX
        : side === 1
          ? bounds.maxX - ax
          : side === 2
            ? az - bounds.minZ
            : bounds.maxZ - az;
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
    }
  }
  out[at] = t0 === 0 ? ax : ax + t0 * dx;
  out[at + 1] = t0 === 0 ? az : az + t0 * dz;
  out[at + 2] = t1 === 1 ? bx : ax + t1 * dx;
  out[at + 3] = t1 === 1 ? bz : az + t1 * dz;
  return true;
}

/** Whether quad p sorts after quad q on (az, bx, bz); ax is already equal. */
function laterThan(raw: Float64Array, p: number, q: number): boolean {
  for (let k = 1; k < 4; k++) {
    const d = (raw[p + k] as number) - (raw[q + k] as number);
    if (d !== 0) return d > 0;
  }
  return false;
}

/**
 * Canonical occluder list: clipped to the bounds, zero-length pieces dropped, each segment
 * oriented and the list sorted by a total order, proper crossings split at one shared point, then
 * the four bounds edges. The result depends only on the multiset of segments, never their order.
 * Returns flat [ax, az, bx, bz] quads.
 */
function prepareSegments(segments: readonly Segment[], bounds: Bounds2): Float64Array {
  const raw = new Float64Array(segments.length * 4);
  let m = 0;
  for (const { a, b } of segments) {
    if (
      !Number.isFinite(a.x) ||
      !Number.isFinite(a.z) ||
      !Number.isFinite(b.x) ||
      !Number.isFinite(b.z)
    )
      continue;
    // Orient before clipping so a reversed segment clips to the same floats.
    const flip = b.x < a.x || (b.x === a.x && b.z < a.z);
    const p = flip ? b : a;
    const q = flip ? a : b;
    const at = m * 4;
    if (
      p.x >= bounds.minX &&
      q.x <= bounds.maxX &&
      Math.min(p.z, q.z) >= bounds.minZ &&
      Math.max(p.z, q.z) <= bounds.maxZ
    ) {
      raw[at] = p.x;
      raw[at + 1] = p.z;
      raw[at + 2] = q.x;
      raw[at + 3] = q.z;
    } else if (!clip(p.x, p.z, q.x, q.z, bounds, raw, at)) continue;
    const ex = (raw[at + 2] as number) - (raw[at] as number);
    const ez = (raw[at + 3] as number) - (raw[at + 1] as number);
    if (ex * ex + ez * ez <= EPS * EPS) continue;
    m++;
  }
  // Lexicographic (ax, az, bx, bz): sort by ax, then settle runs of equal ax (walls on one grid
  // line) by insertion on the remaining keys.
  const ax0 = new Float64Array(m);
  for (let i = 0; i < m; i++) ax0[i] = raw[i * 4] as number;
  const order = sortByKey(ax0, m);
  for (let lo = 0; lo < m;) {
    let hi = lo + 1;
    while (hi < m && ax0[order[hi] as number] === ax0[order[lo] as number]) hi++;
    for (let i = lo + 1; i < hi; i++) {
      const item = order[i] as number;
      let j = i - 1;
      while (j >= lo && laterThan(raw, (order[j] as number) * 4, item * 4)) {
        order[j + 1] = order[j] as number;
        j--;
      }
      order[j + 1] = item;
    }
    lo = hi;
  }
  const seg = new Float64Array(m * 4);
  const len = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    const from = (order[i] as number) * 4;
    seg[i * 4] = raw[from] as number;
    seg[i * 4 + 1] = raw[from + 1] as number;
    seg[i * 4 + 2] = raw[from + 2] as number;
    seg[i * 4 + 3] = raw[from + 3] as number;
    const ex = (raw[from + 2] as number) - (raw[from] as number);
    const ez = (raw[from + 3] as number) - (raw[from + 1] as number);
    len[i] = Math.sqrt(ex * ex + ez * ez);
  }

  // Split proper crossings so the nearest wall can only change at an endpoint (an event).
  // Sorted by minX (= ax), so only pairs whose x ranges overlap are tested.
  const cuts: { t: number; x: number; z: number }[][] = [];
  for (let i = 0; i < m; i++) {
    const ax = seg[i * 4] as number;
    const az = seg[i * 4 + 1] as number;
    const bx = seg[i * 4 + 2] as number;
    const bz = seg[i * 4 + 3] as number;
    const ex = bx - ax;
    const ez = bz - az;
    const tolI = EPS * (len[i] as number);
    const minZ = Math.min(az, bz) - EPS;
    const maxZ = Math.max(az, bz) + EPS;
    for (let j = i + 1; j < m; j++) {
      const cx = seg[j * 4] as number;
      if (cx > bx + EPS) break;
      const cz = seg[j * 4 + 1] as number;
      const dx = seg[j * 4 + 2] as number;
      const dz = seg[j * 4 + 3] as number;
      if ((cz < minZ && dz < minZ) || (cz > maxZ && dz > maxZ)) continue;
      // Cross products are signed distances from the other line times its length.
      const o1 = ex * (cz - az) - ez * (cx - ax);
      const o2 = ex * (dz - az) - ez * (dx - ax);
      if (!((o1 > tolI && o2 < -tolI) || (o1 < -tolI && o2 > tolI))) continue;
      const fx = dx - cx;
      const fz = dz - cz;
      const tolJ = EPS * (len[j] as number);
      const o3 = fx * (az - cz) - fz * (ax - cx);
      const o4 = fx * (bz - cz) - fz * (bx - cx);
      if (!((o3 > tolJ && o4 < -tolJ) || (o3 < -tolJ && o4 > tolJ))) continue;
      const t = o3 / (o3 - o4);
      const u = o1 / (o1 - o2);
      const x = ax + t * ex;
      const z = az + t * ez;
      (cuts[i] ??= []).push({ t, x, z });
      (cuts[j] ??= []).push({ t: u, x, z });
    }
  }

  const out: number[] = [];
  for (let i = 0; i < m; i++) {
    const ax = seg[i * 4] as number;
    const az = seg[i * 4 + 1] as number;
    const bx = seg[i * 4 + 2] as number;
    const bz = seg[i * 4 + 3] as number;
    const list = cuts[i];
    if (!list) {
      out.push(ax, az, bx, bz);
      continue;
    }
    list.sort((p, q) => p.t - q.t || p.x - q.x || p.z - q.z);
    let px = ax;
    let pz = az;
    for (const cut of list) {
      if ((cut.x - px) ** 2 + (cut.z - pz) ** 2 > EPS * EPS) {
        out.push(px, pz, cut.x, cut.z);
        px = cut.x;
        pz = cut.z;
      }
    }
    if ((bx - px) ** 2 + (bz - pz) ** 2 > EPS * EPS) out.push(px, pz, bx, bz);
  }
  const { minX, minZ, maxX, maxZ } = bounds;
  out.push(
    minX,
    minZ,
    maxX,
    minZ,
    maxX,
    minZ,
    maxX,
    maxZ,
    maxX,
    maxZ,
    minX,
    maxZ,
    minX,
    maxZ,
    minX,
    minZ,
  );
  return Float64Array.from(out);
}

const normalizeAngle = (angle: number) => (angle > Math.PI - EPS ? angle - TWO_PI : angle);

/** Squared distance from (px, pz) to a segment, as given (endpoint order agnostic). */
function distance2ToSegment(px: number, pz: number, { a, b }: Segment): number {
  const flip = b.x < a.x || (b.x === a.x && b.z < a.z);
  const p = flip ? b : a;
  const q = flip ? a : b;
  const ex = q.x - p.x;
  const ez = q.z - p.z;
  const wx = px - p.x;
  const wz = pz - p.z;
  const len2 = ex * ex + ez * ez;
  const t = len2 > 0 ? Math.max(0, Math.min(1, (wx * ex + wz * ez) / len2)) : 0;
  const dx = wx - t * ex;
  const dz = wz - t * ez;
  return dx * dx + dz * dz;
}

/** Whether a segment, as given, passes within epsilon of the point (endpoint order agnostic). */
function touches(o: Point2, segment: Segment): boolean {
  return distance2ToSegment(o.x, o.z, segment) <= EPS * EPS;
}

const isFiniteSegment = ({ a, b }: Segment) =>
  Number.isFinite(a.x) && Number.isFinite(a.z) && Number.isFinite(b.x) && Number.isFinite(b.z);

/**
 * The point `visibilityPolygon` actually sweeps from, or null when the origin must see nothing.
 *
 * An origin off every wall and off the bounds edge sweeps from itself. An origin on a wall (within
 * `VISION_EPSILON`, judged on the walls as given) must never see more than a point a hair away
 * would, so it is moved off: every wall it touches gives an arm towards each endpoint farther than
 * epsilon (a mid-wall gives two opposite arms, an endpoint one), and so does every bounds edge it
 * lies on. The candidates are the gaps between consecutive arm angles whose bisector, moved along
 * by `VISION_NUDGE` cells, lands strictly inside the bounds (by more than epsilon). Candidates
 * landing outside every sight-blocking footprint are preferred, so a token on a prop's edge, corner
 * or reflex corner looks out of the prop, never into it; only when every candidate lands inside one
 * do they all compete. Among the preferred, the largest gap wins (ties within epsilon go to the gap
 * starting at the smallest canonical angle), and the origin moves `VISION_NUDGE` along its
 * bisector. So a free wall tip or door jamb looks away from its wall and still sees past it on both
 * sides, a room corner sees only the outside 270°, a T-junction its open 180°, and a mid-wall or
 * crossing one deterministic side or quadrant.
 *
 * `footprints` are the closed outlines of sight-blocking props (world space), only steering that
 * choice: their edges must also be in `segments` to block anything (`visionOccluders` gives both).
 * "Inside" means the strict interior, as in `visionOccluders`: inside and farther than epsilon from
 * the outline. A footprint whose strict interior holds the origin itself is ignored, as
 * `visionOccluders` drops it, so a token inside a prop still prefers to look out of a pillar in it.
 *
 * Null (blind, never "both sides") when no gap points into the bounds, the moved point still
 * touches a wall, or the move from the origin passes within epsilon of a wall it did not touch.
 * Also null when the origin or bounds are not finite or the origin is outside the bounds.
 */
export function visionOrigin(
  origin: Point2,
  segments: readonly Segment[],
  bounds: Bounds2,
  footprints: readonly (readonly Point2[])[] = [],
): Point2 | null {
  const move = visionNudge(origin, segments, bounds, footprints);
  if (!move) return null;
  return move.x === 0 && move.z === 0 ? origin : { x: origin.x + move.x, z: origin.z + move.z };
}

/**
 * The move `visionOrigin` applies, as an offset from the origin ({0, 0} when it stays). The sweep
 * subtracts it from origin-relative coordinates, so an integer translation of the whole scene
 * gives the same relative floats and therefore the same polygon, translated.
 */
function visionNudge(
  origin: Point2,
  segments: readonly Segment[],
  bounds: Bounds2,
  footprints: readonly (readonly Point2[])[],
): Point2 | null {
  const ox = origin.x;
  const oz = origin.z;
  const { minX, minZ, maxX, maxZ } = bounds;
  if (
    !Number.isFinite(ox) ||
    !Number.isFinite(oz) ||
    !(minX <= maxX && minZ <= maxZ) ||
    ox < minX - EPS ||
    ox > maxX + EPS ||
    oz < minZ - EPS ||
    oz > maxZ + EPS
  )
    return null;

  const arms: number[] = [];
  const addArms = (segment: Segment) => {
    if (!touches(origin, segment)) return;
    for (const end of [segment.a, segment.b]) {
      const dx = end.x - ox;
      const dz = end.z - oz;
      if (dx * dx + dz * dz > EPS * EPS) arms.push(normalizeAngle(Math.atan2(dz, dx)));
    }
  };
  for (const segment of segments) if (isFiniteSegment(segment)) addArms(segment);
  const corners = [
    { x: minX, z: minZ },
    { x: maxX, z: minZ },
    { x: maxX, z: maxZ },
    { x: minX, z: maxZ },
  ];
  for (let i = 0; i < 4; i++)
    addArms({ a: corners[i] as Point2, b: corners[(i + 1) % 4] as Point2 });
  if (arms.length === 0) return { x: 0, z: 0 };

  arms.sort((p, q) => p - q);
  // Footprints the origin is strictly inside do not block it (visionOccluders), so never steer.
  const blocking = footprints.filter((f) => !strictlyInside(origin, f));
  // Best candidate overall and best landing outside every footprint; the second wins if any.
  // Gaps of at most epsilon (duplicate arms, e.g. a shared prop edge) run along a wall: the moved
  // point would touch it, so they are never candidates.
  let anyMove: Point2 | null = null;
  let anyGap = 0;
  let outMove: Point2 | null = null;
  let outGap = 0;
  for (let i = 0; i < arms.length; i++) {
    const start = arms[i] as number;
    const gap =
      (i + 1 < arms.length ? (arms[i + 1] as number) : (arms[0] as number) + TWO_PI) - start;
    // outGap <= anyGap, so a gap that cannot beat outGap cannot beat either.
    if (!(gap > outGap + EPS)) continue;
    const mid = start + gap / 2;
    const dx = VISION_NUDGE * Math.cos(mid);
    const dz = VISION_NUDGE * Math.sin(mid);
    const x = ox + dx;
    const z = oz + dz;
    // Into the bounds: strictly inside by more than epsilon, so the moved point is on no edge.
    if (x <= minX + EPS || x >= maxX - EPS || z <= minZ + EPS || z >= maxZ - EPS) continue;
    if (gap > anyGap + EPS) {
      anyMove = { x: dx, z: dz };
      anyGap = gap;
    }
    if (!blocking.some((f) => strictlyInside({ x, z }, f))) {
      outMove = { x: dx, z: dz };
      outGap = gap;
    }
  }
  const move = outMove ?? anyMove;
  if (!move) return null;

  // Safe fallback: the moved point must be clear of every wall, and the hop to it must not cross
  // or graze one, or the sweep could see from somewhere the origin cannot.
  const ex = ox + move.x;
  const ez = oz + move.z;
  const path: Segment = { a: origin, b: { x: ex, z: ez } };
  const side = (ax: number, az: number, bx: number, bz: number, px: number, pz: number) =>
    (bx - ax) * (pz - az) - (bz - az) * (px - ax);
  for (const segment of segments) {
    if (!isFiniteSegment(segment)) continue;
    if (distance2ToSegment(ex, ez, segment) <= EPS * EPS) return null;
    if (touches(origin, segment)) continue;
    const { a, b } = segment;
    if (
      distance2ToSegment(a.x, a.z, path) <= EPS * EPS ||
      distance2ToSegment(b.x, b.z, path) <= EPS * EPS
    )
      return null;
    const d1 = side(a.x, a.z, b.x, b.z, ox, oz);
    const d2 = side(a.x, a.z, b.x, b.z, ex, ez);
    const d3 = side(ox, oz, ex, ez, a.x, a.z);
    const d4 = side(ox, oz, ex, ez, b.x, b.z);
    if (d1 * d2 < 0 && d3 * d4 < 0) return null;
  }
  return move;
}

/**
 * The region visible from `origin`, as a simple polygon with positive signed area in (x, z),
 * starting from the ray towards -X and sweeping by increasing atan2(z, x). The bounds rectangle
 * always occludes; if the origin is outside the bounds the result is `[]`.
 *
 * Rules: walls have zero thickness, and a wall seen exactly edge-on blocks nothing. An origin on a
 * wall, a wall endpoint or the bounds edge never sees more than a point a hair away: it sweeps from
 * `visionOrigin`, the origin moved `VISION_NUDGE` cells into the largest free gap between the
 * walls it touches, preferring gaps that lead out of the sight-blocking `footprints` (optional
 * outlines that only steer this choice; see `visionOrigin`), with every wall kept. So a mid-wall
 * origin sees one deterministic side, a room corner the outside only, a token on a prop's edge or
 * corner looks away from the prop, and a free wall tip sees both sides of the wall's line. When no
 * such point is safe the result is `[]` (blind), never both sides. Otherwise the true origin lies
 * on the result (the boundary counts as inside). Shared endpoints (L-corners, T-junctions,
 * polylines) never leak.
 *
 * Angular sweep over endpoint events, O(n log n) plus the open set scanned per event interval.
 * Between two consecutive event angles the nearest wall cannot change (crossings are split), so it
 * is chosen once along the mid-angle ray and then intersected with the two exact event rays.
 * Events within epsilon of a group's first angle share its ray, so a group can leave a wedge at
 * most `VISION_EPSILON` radians wide; that cannot hold an inset sample, so it is not exploitable.
 * See the module header: bit-identical within one JS engine only.
 */
export function visibilityPolygon(
  origin: Point2,
  segments: readonly Segment[],
  bounds: Bounds2,
  footprints: readonly (readonly Point2[])[] = [],
): Point2[] {
  const move = visionNudge(origin, segments, bounds, footprints);
  if (!move) return [];
  // The sweep runs from the eye, origin + move; relative coordinates are (p - origin) - move.
  const mx = move.x;
  const mz = move.z;
  const ox = origin.x + mx;
  const oz = origin.z + mz;
  const world = prepareSegments(segments, bounds);
  const total = world.length / 4;

  // Per usable segment: origin-relative endpoints, oriented so a -> b is counter-clockwise.
  const rel = new Float64Array(total * 4);
  const worldIndex = new Int32Array(total);
  const swapped = new Uint8Array(total);
  const eventAngle = new Float64Array(total * 2);
  let n = 0;
  for (let i = 0; i < total; i++) {
    let ax = (world[i * 4] as number) - origin.x - mx;
    let az = (world[i * 4 + 1] as number) - origin.z - mz;
    let bx = (world[i * 4 + 2] as number) - origin.x - mx;
    let bz = (world[i * 4 + 3] as number) - origin.z - mz;
    const ex = bx - ax;
    const ez = bz - az;
    const len2 = ex * ex + ez * ez;
    const t = Math.max(0, Math.min(1, -(ax * ex + az * ez) / len2));
    const cx = ax + t * ex;
    const cz = az + t * ez;
    // Through the eye: only a wall at most 2 epsilon long can get here (a longer one gives an arm
    // and visionOrigin moves the eye off it).
    if (cx * cx + cz * cz <= EPS * EPS) continue;
    let angA = normalizeAngle(Math.atan2(az, ax));
    let angB = normalizeAngle(Math.atan2(bz, bx));
    let span = angB - angA;
    if (span > Math.PI) span -= TWO_PI;
    else if (span <= -Math.PI) span += TWO_PI;
    let swap = 0;
    if (span < 0) {
      [ax, az, bx, bz, angA, angB] = [bx, bz, ax, az, angB, angA];
      span = -span;
      swap = 1;
    }
    if (span <= EPS) continue; // edge-on
    rel[n * 4] = ax;
    rel[n * 4 + 1] = az;
    rel[n * 4 + 2] = bx;
    rel[n * 4 + 3] = bz;
    worldIndex[n] = i;
    swapped[n] = swap;
    // Event k = 2s is the start (a), 2s + 1 the end (b). Segments are already canonical, so
    // sorting events by angle then index is a total order.
    eventAngle[n * 2] = angA;
    eventAngle[n * 2 + 1] = angB;
    n++;
  }

  // Group events whose angles are within epsilon of the group's first; each group is one ray.
  // Order inside a group does not matter: its events are applied as a set.
  const events = n * 2;
  const order = sortByKey(eventAngle, events);
  const groupStart: number[] = [];
  const groupOf = new Int32Array(events);
  const offset: number[] = [];
  for (let i = 0; i < events; i++) {
    const k = order[i] as number;
    const angle = eventAngle[k] as number;
    const last = groupStart.length - 1;
    if (last < 0 || angle - (groupStart[last] as number) > EPS) {
      groupStart.push(angle);
      offset.push(i);
    }
    groupOf[k] = groupStart.length - 1;
  }
  const groups = groupStart.length;
  offset.push(events);
  // Each group's ray points at its first event's endpoint (not normalised: the hit point
  // o + t * d does not depend on the length of d). The unit vectors give the mid-interval rays.
  const rayX = new Float64Array(groups);
  const rayZ = new Float64Array(groups);
  const unitX = new Float64Array(groups);
  const unitZ = new Float64Array(groups);
  for (let g = 0; g < groups; g++) {
    const k = order[offset[g] as number] as number;
    const at = (k >> 1) * 4 + (k & 1) * 2;
    const x = rel[at] as number;
    const z = rel[at + 1] as number;
    const len = Math.sqrt(x * x + z * z);
    rayX[g] = x;
    rayZ[g] = z;
    unitX[g] = x / len;
    unitZ[g] = z / len;
  }

  // Open set: segments spanning the current interval. Wrapping segments start open.
  const active = new Int32Array(n);
  const slot = new Int32Array(n).fill(-1);
  let open = 0;
  const add = (s: number) => {
    slot[s] = open;
    active[open++] = s;
  };
  const remove = (s: number) => {
    const at = slot[s] as number;
    const moved = active[--open] as number;
    active[at] = moved;
    slot[moved] = at;
    slot[s] = -1;
  };
  for (let s = 0; s < n; s++) {
    if ((eventAngle[s * 2] as number) > (eventAngle[s * 2 + 1] as number)) add(s);
  }

  const xs: number[] = [];
  const zs: number[] = [];
  const push = (x: number, z: number) => {
    const last = xs.length - 1;
    if (
      last >= 0 &&
      Math.abs(x - (xs[last] as number)) <= EPS &&
      Math.abs(z - (zs[last] as number)) <= EPS
    )
      return;
    xs.push(x);
    zs.push(z);
  };
  // The point where segment s meets the ray of group g, exact when g holds one of its endpoints.
  const hit = (s: number, g: number) => {
    const w = (worldIndex[s] as number) * 4;
    const end = (swapped[s] as number) === 0 ? 0 : 2;
    if (groupOf[s * 2] === g) {
      push(world[w + end] as number, world[w + end + 1] as number);
      return;
    }
    if (groupOf[s * 2 + 1] === g) {
      push(world[w + 2 - end] as number, world[w + 3 - end] as number);
      return;
    }
    const dx = rayX[g] as number;
    const dz = rayZ[g] as number;
    const ax = rel[s * 4] as number;
    const az = rel[s * 4 + 1] as number;
    const ex = (rel[s * 4 + 2] as number) - ax;
    const ez = (rel[s * 4 + 3] as number) - az;
    const t = (ax * ez - az * ex) / (dx * ez - dz * ex);
    if (Number.isFinite(t) && t > 0) push(ox + t * dx, oz + t * dz);
    else push(ox, oz);
  };

  for (let g = 0; g < groups; g++) {
    for (let i = offset[g] as number; i < (offset[g + 1] as number); i++) {
      const k = order[i] as number;
      const s = k >> 1;
      if ((k & 1) === 0) {
        if (slot[s] === -1) add(s);
      } else if (slot[s] !== -1) remove(s);
    }
    const next = (g + 1) % groups;
    // Mid-interval ray: the bisector of the two unit rays while the gap is under a half turn.
    let dx = (unitX[g] as number) + (unitX[next] as number);
    let dz = (unitZ[g] as number) + (unitZ[next] as number);
    const gap = (groupStart[next] as number) - (groupStart[g] as number) + (next <= g ? TWO_PI : 0);
    if (gap >= Math.PI / 2) {
      const mid = (groupStart[g] as number) + gap / 2;
      dx = Math.cos(mid);
      dz = Math.sin(mid);
    }
    let best = -1;
    let bestT = Infinity;
    for (let i = 0; i < open; i++) {
      const s = active[i] as number;
      const ax = rel[s * 4] as number;
      const az = rel[s * 4 + 1] as number;
      const ex = (rel[s * 4 + 2] as number) - ax;
      const ez = (rel[s * 4 + 3] as number) - az;
      const t = (ax * ez - az * ex) / (dx * ez - dz * ex);
      if (t < bestT - EPS || (t <= bestT + EPS && s < best)) {
        best = s;
        bestT = t;
      }
    }
    if (best < 0) {
      push(ox, oz);
    } else {
      hit(best, g);
      hit(best, next);
    }
  }

  let count = xs.length;
  while (
    count > 1 &&
    Math.abs((xs[count - 1] as number) - (xs[0] as number)) <= EPS &&
    Math.abs((zs[count - 1] as number) - (zs[0] as number)) <= EPS
  )
    count--;
  const polygon: Point2[] = [];
  for (let i = 0; i < count; i++) polygon.push({ x: xs[i] as number, z: zs[i] as number });
  return polygon;
}
