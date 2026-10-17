import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { makeEntity } from '../actions/testing.js';
import type { Point2 } from './primitives.js';
import { primitiveFootprint } from './primitives.js';
import {
  isSeen,
  pointInPolygon,
  polygonSegments,
  sightSamples,
  TOKEN_SAMPLE_INSET,
  visibilityPolygon,
  visionOccluders,
  wallSegments,
  type Bounds2,
  type Segment,
} from './vision.js';

const BOUNDS: Bounds2 = { minX: 0, minZ: 0, maxX: 20, maxZ: 20 };
const p = (x: number, z: number): Point2 => ({ x, z });
const seg = (ax: number, az: number, bx: number, bz: number): Segment => ({
  a: p(ax, az),
  b: p(bx, bz),
});
const rect = (x0: number, z0: number, x1: number, z1: number) =>
  polygonSegments([p(x0, z0), p(x1, z0), p(x1, z1), p(x0, z1)]);

const area = (poly: readonly Point2[]) => {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as Point2;
    const b = poly[(i + 1) % poly.length] as Point2;
    sum += a.x * b.z - b.x * a.z;
  }
  return sum / 2;
};

const distToSegment = (q: Point2, s: Segment) => {
  const ex = s.b.x - s.a.x;
  const ez = s.b.z - s.a.z;
  const len2 = ex * ex + ez * ez;
  const t =
    len2 === 0 ? 0 : Math.max(0, Math.min(1, ((q.x - s.a.x) * ex + (q.z - s.a.z) * ez) / len2));
  return Math.hypot(q.x - s.a.x - t * ex, q.z - s.a.z - t * ez);
};

const boundsEdges = (b: Bounds2) => rect(b.minX, b.minZ, b.maxX, b.maxZ);

const distToBoundary = (q: Point2, poly: readonly Point2[]) =>
  Math.min(...polygonSegments(poly).map((s) => distToSegment(q, s)));

/** Finite, no consecutive duplicates (wrap included), counter-clockwise in (x, z), at least a triangle. */
function expectWellFormed(poly: readonly Point2[]) {
  expect(poly.length).toBeGreaterThanOrEqual(3);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as Point2;
    const b = poly[(i + 1) % poly.length] as Point2;
    expect(Number.isFinite(a.x) && Number.isFinite(a.z)).toBe(true);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(1e-9);
  }
  expect(area(poly)).toBeGreaterThan(0);
}

function expectVerticesOnOccluders(
  poly: readonly Point2[],
  segments: readonly Segment[],
  b: Bounds2,
  origin?: Point2,
) {
  const all = [...segments, ...boundsEdges(b)];
  for (const v of poly) {
    if (origin && v.x === origin.x && v.z === origin.z) continue;
    expect(Math.min(...all.map((s) => distToSegment(v, s)))).toBeLessThan(1e-7);
  }
}

const sees = (origin: Point2, segments: readonly Segment[], q: Point2, bounds = BOUNDS) =>
  pointInPolygon(q, visibilityPolygon(origin, segments, bounds));

describe('pointInPolygon', () => {
  const square = [p(0, 0), p(2, 0), p(2, 2), p(0, 2)];
  it('counts the boundary (edges and vertices, within epsilon) as inside', () => {
    expect(pointInPolygon(p(1, 1), square)).toBe(true);
    expect(pointInPolygon(p(2, 1), square)).toBe(true);
    expect(pointInPolygon(p(0, 0), square)).toBe(true);
    expect(pointInPolygon(p(1, 2 + 5e-10), square)).toBe(true);
    expect(pointInPolygon(p(1, 2 + 1e-6), square)).toBe(false);
    expect(pointInPolygon(p(3, 1), square)).toBe(false);
  });
  it('works for either winding and concave shapes; degenerate polygons contain nothing', () => {
    const concave = [p(0, 0), p(4, 0), p(4, 4), p(2, 1), p(0, 4)];
    expect(pointInPolygon(p(2, 3), concave)).toBe(false);
    expect(pointInPolygon(p(1, 1), [...concave].reverse())).toBe(true);
    expect(pointInPolygon(p(0, 0), [p(0, 0), p(1, 1)])).toBe(false);
  });
});

describe('visibilityPolygon: named examples', () => {
  it('returns the bounds rectangle, counter-clockwise, with no walls', () => {
    expect(visibilityPolygon(p(10, 10), [], BOUNDS)).toEqual([
      p(0, 0),
      p(20, 0),
      p(20, 20),
      p(0, 20),
    ]);
  });

  it('a closed room hides the outside', () => {
    const walls = rect(5, 5, 10, 10);
    const poly = visibilityPolygon(p(7, 7), walls, BOUNDS);
    expectWellFormed(poly);
    expect(area(poly)).toBeCloseTo(25, 9);
    expect(pointInPolygon(p(9.9, 9.9), poly)).toBe(true);
    expect(pointInPolygon(p(10, 7), poly)).toBe(true); // on the wall: boundary is inside
    expect(pointInPolygon(p(15, 15), poly)).toBe(false);
    expect(pointInPolygon(p(10.01, 7), poly)).toBe(false);
  });

  it('a room with a one-cell door gap shows a wedge through the gap', () => {
    // Right wall has a gap for z in [7, 8].
    const walls = [
      seg(5, 5, 10, 5),
      seg(10, 5, 10, 7),
      seg(10, 8, 10, 10),
      seg(10, 10, 5, 10),
      seg(5, 10, 5, 5),
    ];
    const origin = p(7.5, 7.5);
    const poly = visibilityPolygon(origin, walls, BOUNDS);
    expectWellFormed(poly);
    expectVerticesOnOccluders(poly, walls, BOUNDS);
    // The wedge widens from 1 cell at x = 10 to 5 cells at x = 20 (lines through the door jambs).
    expect(pointInPolygon(p(19, 7.5), poly)).toBe(true);
    expect(pointInPolygon(p(19, 5.4), poly)).toBe(true);
    expect(pointInPolygon(p(19, 9.6), poly)).toBe(true);
    expect(pointInPolygon(p(19, 5.0), poly)).toBe(false);
    expect(pointInPolygon(p(19, 10.0), poly)).toBe(false);
    expect(pointInPolygon(p(15, 15), poly)).toBe(false);
    expect(pointInPolygon(p(2, 7.5), poly)).toBe(false);
  });

  it('a pillar casts a shadow behind it', () => {
    const walls = rect(10, 10, 11, 11);
    const origin = p(5, 10.5);
    expect(sees(origin, walls, p(15, 10.5))).toBe(false);
    expect(sees(origin, walls, p(15, 11.2))).toBe(false);
    expect(sees(origin, walls, p(15, 12.5))).toBe(true);
    expect(sees(origin, walls, p(15, 5))).toBe(true);
    expect(sees(origin, walls, p(10, 10.5))).toBe(true); // the near face itself
  });

  it('an L-shaped corridor hides the far leg', () => {
    const walls = [
      ...wallSegments(
        [p(0, 0), p(10, 0), p(10, 10), p(8, 10), p(8, 2), p(0, 2), p(0, 0)],
        p(0, 0),
        0,
      ),
    ];
    const origin = p(1, 1);
    const poly = visibilityPolygon(origin, walls, BOUNDS);
    expectWellFormed(poly);
    expect(pointInPolygon(p(5, 1), poly)).toBe(true);
    expect(pointInPolygon(p(9, 1.5), poly)).toBe(true);
    expect(pointInPolygon(p(9, 9), poly)).toBe(false);
    expect(pointInPolygon(p(9, 5), poly)).toBe(false);
  });

  it('an origin on a wall endpoint is non-empty, contains the origin and sees both sides', () => {
    const walls = rect(5, 5, 10, 10);
    for (const origin of [p(5, 5), p(10, 10)]) {
      const poly = visibilityPolygon(origin, walls, BOUNDS);
      expectWellFormed(poly);
      expect(pointInPolygon(origin, poly)).toBe(true);
    }
    expect(sees(p(5, 5), walls, p(7, 7))).toBe(true);
    expect(sees(p(5, 5), walls, p(3, 3))).toBe(true);
    // Beyond the far walls of the room is still hidden.
    expect(sees(p(5, 5), walls, p(15, 15))).toBe(false);
  });

  it('an origin in the middle of a wall is non-empty, contains the origin and sees both sides', () => {
    const walls = [seg(5, 10, 15, 10)];
    const origin = p(10, 10);
    const poly = visibilityPolygon(origin, walls, BOUNDS);
    expectWellFormed(poly);
    expect(pointInPolygon(origin, poly)).toBe(true);
    expect(pointInPolygon(p(10, 2), poly)).toBe(true);
    expect(pointInPolygon(p(10, 18), poly)).toBe(true);
    // A wall through the eye is edge-on in every direction it occupies.
    expect(area(poly)).toBeCloseTo(400, 9);
  });

  it('an origin inside a sight-blocking footprint is not blind; others still block', () => {
    const prop = primitiveFootprint('box', { x: 4, y: 1, z: 4 }).map((q) => p(q.x + 8, q.z + 8));
    const pillar = [p(14, 7.5), p(15, 7.5), p(15, 8.5), p(14, 8.5)];
    const occluders = [
      { kind: 'footprint' as const, outline: prop },
      { kind: 'footprint' as const, outline: pillar },
    ];
    const inside = p(8, 8);
    const fromInside = visionOccluders(inside, occluders);
    expect(fromInside).toEqual(polygonSegments(pillar));
    expect(sees(inside, fromInside, p(18, 18))).toBe(true);
    expect(sees(inside, fromInside, p(18, 8))).toBe(false); // behind the pillar
    // On the outline counts as inside the footprint too.
    expect(visionOccluders(p(10, 8), occluders)).toEqual(polygonSegments(pillar));
    // From outside, the prop blocks.
    const outside = p(2, 8);
    expect(sees(outside, visionOccluders(outside, occluders), p(12, 8))).toBe(false);
    expect(
      visionOccluders(outside, [{ kind: 'segments', segments: [seg(1, 1, 2, 2)] }, ...occluders]),
    ).toHaveLength(9);
  });

  it('a large token half behind a wall is seen through its exposed corner', () => {
    const wall = [seg(10, 8, 10, 10.5)];
    const origin = p(5, 10);
    const poly = visibilityPolygon(origin, wall, BOUNDS);
    const large = makeEntity('T', {
      transform: {
        position: { x: 11, y: 0, z: 10 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
      },
      token: { sizeCells: 2, heightCells: 2, labelVisibility: 'all' },
    });
    const samples = sightSamples(large);
    expect(pointInPolygon(samples[0] as Point2, poly)).toBe(false); // centre is hidden
    expect(isSeen([poly], samples)).toBe(true);
    const small = {
      ...large,
      token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' as const },
    };
    expect(
      isSeen(
        [poly],
        sightSamples({
          ...small,
          transform: { ...small.transform, position: { x: 11, y: 0, z: 9.2 } },
        }),
      ),
    ).toBe(false);
  });

  it('crossing walls are split, so the nearer arm always wins', () => {
    const walls = [seg(5, 5, 15, 15), seg(5, 15, 15, 5)];
    const origin = p(10, 2);
    const poly = visibilityPolygon(origin, walls, BOUNDS);
    expectWellFormed(poly);
    expectVerticesOnOccluders(poly, walls, BOUNDS);
    expect(pointInPolygon(p(10, 9), poly)).toBe(true);
    expect(pointInPolygon(p(7, 6), poly)).toBe(true);
    expect(pointInPolygon(p(10, 12), poly)).toBe(false);
    expect(pointInPolygon(p(12, 11), poly)).toBe(false);
    expect(pointInPolygon(p(8, 11), poly)).toBe(false);
  });
});

describe('visibilityPolygon: edge cases', () => {
  it('two collinear walls sharing an endpoint leak no light through the shared vertex', () => {
    const walls = [seg(6, 10, 10, 10), seg(10, 10, 14, 10)];
    const origin = p(10, 5);
    const poly = visibilityPolygon(origin, walls, BOUNDS);
    expectWellFormed(poly);
    expect(pointInPolygon(p(10, 15), poly)).toBe(false);
    expect(pointInPolygon(p(10, 10.001), poly)).toBe(false);
    expect(pointInPolygon(p(10, 10), poly)).toBe(true);
  });

  it('overlapping collinear walls block like their union', () => {
    const walls = [seg(6, 10, 11, 10), seg(9, 10, 14, 10), seg(10, 10, 10.5, 10)];
    const origin = p(10, 5);
    const poly = visibilityPolygon(origin, walls, BOUNDS);
    expectWellFormed(poly);
    expectVerticesOnOccluders(poly, walls, BOUNDS);
    for (const x of [6.5, 9, 10, 11, 13.9])
      expect(pointInPolygon(p(10 + (x - 10) * 2, 15), poly)).toBe(false);
    expect(area(poly)).toBeCloseTo(
      area(visibilityPolygon(origin, [seg(6, 10, 14, 10)], BOUNDS)),
      9,
    );
  });

  it('a wall collinear with the ray from the origin is edge-on and blocks nothing', () => {
    const origin = p(10, 5);
    const poly = visibilityPolygon(origin, [seg(10, 8, 10, 12)], BOUNDS);
    expectWellFormed(poly);
    expect(area(poly)).toBeCloseTo(400, 9);
    expect(pointInPolygon(p(10, 15), poly)).toBe(true);
    // But it still forms a corner with a wall that is not edge-on.
    const corner = [seg(10, 8, 10, 12), seg(10, 12, 14, 12)];
    expect(sees(origin, corner, p(12, 16))).toBe(false);
    expect(sees(origin, corner, p(8, 16))).toBe(true);
  });

  it('L-corners, T-junctions and polylines leak nothing through shared vertices', () => {
    const origin = p(5, 5);
    // L-corner whose vertex is exactly on the ray through (15, 15).
    const l = [seg(10, 5, 10, 10), seg(10, 10, 5, 10)];
    expect(sees(origin, l, p(15, 15))).toBe(false);
    expect(sees(origin, l, p(10.0001, 10.0001))).toBe(false);
    // T-junction: the stem ends in the middle of the bar.
    const t = [seg(6, 12, 14, 12), seg(10, 12, 10, 8)];
    const tPoly = visibilityPolygon(p(10, 5), t, BOUNDS);
    expectWellFormed(tPoly);
    expect(pointInPolygon(p(9, 15), tPoly)).toBe(false);
    expect(pointInPolygon(p(11, 15), tPoly)).toBe(false);
    // A ray exactly through the junction, from the stem's other side.
    expect(sees(p(7, 15), t, p(13, 9))).toBe(false);
    expect(sees(p(7, 15), t, p(10, 12))).toBe(true);
    // A zigzag polyline (rotated) with every vertex aimed at the origin in turn.
    const zigzag = wallSegments([p(-4, 0), p(-2, 1), p(0, 0), p(2, 1), p(4, 0)], p(10, 12), 0);
    for (const v of [p(8, 13), p(10, 12), p(12, 13)]) {
      const beyond = p(10 + (v.x - 10) * 1.5, 5 + (v.z - 5) * 1.5);
      expect(sees(p(10, 5), zigzag, beyond)).toBe(false);
    }
  });

  it('zero-length and non-finite segments are ignored', () => {
    const origin = p(10, 10);
    expect(
      visibilityPolygon(
        origin,
        [seg(3, 3, 3, 3), seg(5, 5, 5 + 1e-12, 5), seg(1, 1, Number.NaN, 2)],
        BOUNDS,
      ),
    ).toEqual(visibilityPolygon(origin, [], BOUNDS));
  });

  it('origin on the bounds edge or corner sees the room; outside the bounds sees nothing', () => {
    for (const origin of [p(0, 10), p(20, 3), p(0, 0), p(20, 20)]) {
      const poly = visibilityPolygon(origin, [], BOUNDS);
      expectWellFormed(poly);
      expect(pointInPolygon(origin, poly)).toBe(true);
      expect(area(poly)).toBeCloseTo(400, 9);
    }
    expect(visibilityPolygon(p(-0.5, 10), [], BOUNDS)).toEqual([]);
    expect(visibilityPolygon(p(10, 20.1), [], BOUNDS)).toEqual([]);
    expect(visibilityPolygon(p(Number.NaN, 1), [], BOUNDS)).toEqual([]);
  });

  it('walls are clipped to the bounds', () => {
    const walls = [seg(-5, 10, 25, 10)];
    const poly = visibilityPolygon(p(10, 5), walls, BOUNDS);
    expectWellFormed(poly);
    expect(area(poly)).toBeCloseTo(200, 9);
  });
});

describe('sightSamples', () => {
  const transform = (x: number, z: number, yaw = 0) => ({
    position: { x, y: 3, z },
    rotation: { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) },
    scale: { x: 1, y: 1, z: 1 },
  });

  it('gives a token its centre and inset corners', () => {
    const h = 1 - TOKEN_SAMPLE_INSET;
    expect(
      sightSamples({
        transform: transform(4, 6),
        token: { sizeCells: 2, heightCells: 2, labelVisibility: 'all' },
      }),
    ).toEqual([p(4, 6), p(4 - h, 6 - h), p(4 + h, 6 - h), p(4 + h, 6 + h), p(4 - h, 6 + h)]);
  });

  it('gives an AoE its centre and footprint corners', () => {
    expect(
      sightSamples({
        transform: transform(4, 6),
        aoe: { kind: 'sphere', radius: 2, color: '#f00' },
      }),
    ).toEqual([p(4, 6), p(2, 4), p(6, 4), p(6, 8), p(2, 8)]);
    expect(
      sightSamples({
        transform: transform(0, 0),
        aoe: { kind: 'line', length: 6, width: 1, height: 1, color: '#f00' },
      }),
    ).toEqual([p(0, 0), p(-0.5, 0), p(0.5, 0), p(0.5, 6), p(-0.5, 6)]);
    // A cone turned a quarter turn about +Y points along +X.
    const cone = sightSamples({
      transform: transform(0, 0, Math.PI / 2),
      aoe: { kind: 'cone', radius: 1, length: 4, color: '#f00' },
    });
    expect(cone).toHaveLength(5);
    expect(Math.max(...cone.map((q) => q.x))).toBeCloseTo(4, 9);
    expect(Math.min(...cone.map((q) => q.x))).toBeCloseTo(0, 9);
    expect(
      sightSamples({ transform: transform(1, 1), aoe: { kind: 'cube', size: 2, color: '#f00' } }),
    ).toHaveLength(5);
    expect(
      sightSamples({
        transform: transform(1, 1),
        aoe: { kind: 'cylinder', radius: 1, height: 3, color: '#f00' },
      }),
    ).toHaveLength(5);
  });

  it('gives a pin and anything else its position', () => {
    expect(
      sightSamples({ transform: transform(4, 6), pin: { text: 'x', reveal: 'hover' } }),
    ).toEqual([p(4, 6)]);
    expect(sightSamples({ transform: transform(4, 6) })).toEqual([p(4, 6)]);
    expect(
      sightSamples({ transform: transform(4, 6), aoe: { kind: 'sphere', size: 3, color: '#f00' } }),
    ).toEqual([p(4, 6)]);
  });
});

describe('isSeen', () => {
  it('is true when any sample is inside any polygon', () => {
    const a = [p(0, 0), p(1, 0), p(1, 1), p(0, 1)];
    const b = [p(5, 5), p(6, 5), p(6, 6), p(5, 6)];
    expect(isSeen([a, b], [p(9, 9), p(5.5, 5.5)])).toBe(true);
    expect(isSeen([a, b], [p(9, 9), p(3, 3)])).toBe(false);
    expect(isSeen([], [p(0.5, 0.5)])).toBe(false);
    expect(isSeen([a], [])).toBe(false);
  });
});

describe('wallSegments', () => {
  it('rotates local points about +Y like primitiveFootprint, then places them', () => {
    const [s] = wallSegments([p(0, 0), p(1, 0)], p(5, 5), Math.PI / 2);
    expect(s?.a).toEqual(p(5, 5));
    expect(s?.b.x).toBeCloseTo(5, 12);
    expect(s?.b.z).toBeCloseTo(4, 12);
    expect(wallSegments([p(0, 0)], p(0, 0), 0)).toEqual([]);
  });
});

// Integer coordinates keep translation exact, so properties compare exactly where they can.
const coord = fc.integer({ min: 0, max: 20 });
const segmentArb = fc.record({
  a: fc.record({ x: coord, z: coord }),
  b: fc.record({ x: coord, z: coord }),
});
const segmentsArb = fc.array(segmentArb, { maxLength: 24 });
// Half-cell origins often sit on walls, wall extensions and diagonals.
const originArb = fc
  .record({ x: fc.integer({ min: 1, max: 39 }), z: fc.integer({ min: 1, max: 39 }) })
  .map(({ x, z }) => p(x / 2, z / 2));
const PROPS = { seed: 296, numRuns: 300 } as const;

const grid: Point2[] = [];
for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) grid.push(p(i + 0.37, j + 0.61));

/**
 * Brute-force line of sight: q is visible when the open segment origin -> q properly crosses no
 * wall. Walls touching the origin are ignored (zero thickness, see visibilityPolygon). Returns
 * undefined when the sight line passes within 1e-6 of a wall endpoint or q is within 1e-6 of a
 * wall, where the answer depends on the boundary rules rather than the sweep.
 */
function bruteSees(origin: Point2, segments: readonly Segment[], q: Point2): boolean | undefined {
  const sight = { a: origin, b: q };
  const cross = (o: Point2, a: Point2, b: Point2) =>
    (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  for (const w of segments) {
    if (Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z) === 0) continue;
    if (distToSegment(origin, w) <= 1e-9) continue;
    if (distToSegment(w.a, sight) < 1e-6 || distToSegment(w.b, sight) < 1e-6) return undefined;
    if (distToSegment(q, w) < 1e-6) return undefined;
    const d1 = cross(w.a, w.b, origin);
    const d2 = cross(w.a, w.b, q);
    const d3 = cross(origin, q, w.a);
    const d4 = cross(origin, q, w.b);
    if (d1 * d2 < 0 && d3 * d4 < 0) return false;
  }
  return true;
}

describe('visibilityPolygon: properties', () => {
  it('contains its origin and is well formed', () => {
    fc.assert(
      fc.property(originArb, segmentsArb, (origin, segments) => {
        const poly = visibilityPolygon(origin, segments, BOUNDS);
        expectWellFormed(poly);
        expect(pointInPolygon(origin, poly)).toBe(true);
      }),
      PROPS,
    );
  });

  it('agrees with a brute-force line-of-sight check away from boundaries', () => {
    fc.assert(
      fc.property(originArb, segmentsArb, (origin, segments) => {
        const poly = visibilityPolygon(origin, segments, BOUNDS);
        for (const q of grid) {
          const expected = bruteSees(origin, segments, q);
          if (expected === undefined || distToBoundary(q, poly) < 1e-6) continue;
          expect(pointInPolygon(q, poly)).toBe(expected);
        }
      }),
      PROPS,
    );
  });

  it('never grows when a segment is added', () => {
    fc.assert(
      fc.property(originArb, segmentsArb, segmentArb, (origin, segments, extra) => {
        const before = visibilityPolygon(origin, segments, BOUNDS);
        const after = visibilityPolygon(origin, [...segments, extra], BOUNDS);
        expect(area(after)).toBeLessThanOrEqual(area(before) + 1e-9);
        for (const q of grid) {
          if (pointInPolygon(q, after) && distToBoundary(q, after) > 1e-6)
            expect(pointInPolygon(q, before)).toBe(true);
        }
      }),
      PROPS,
    );
  });

  it('translates with the origin, segments and bounds', () => {
    fc.assert(
      fc.property(
        originArb,
        segmentsArb,
        fc.integer({ min: -50, max: 50 }),
        fc.integer({ min: -50, max: 50 }),
        (origin, segments, dx, dz) => {
          const move = (q: Point2) => p(q.x + dx, q.z + dz);
          const poly = visibilityPolygon(origin, segments, BOUNDS);
          const moved = visibilityPolygon(
            move(origin),
            segments.map((s) => ({ a: move(s.a), b: move(s.b) })),
            { minX: dx, minZ: dz, maxX: 20 + dx, maxZ: 20 + dz },
          );
          expect(moved).toHaveLength(poly.length);
          moved.forEach((v, i) => {
            const w = poly[i] as Point2;
            expect(Math.abs(v.x - (w.x + dx))).toBeLessThan(1e-9);
            expect(Math.abs(v.z - (w.z + dz))).toBeLessThan(1e-9);
          });
        },
      ),
      PROPS,
    );
  });

  it('does not depend on segment order or endpoint order', () => {
    fc.assert(
      fc.property(
        originArb,
        segmentsArb.chain((segments) =>
          fc.tuple(
            fc.constant(segments),
            fc.shuffledSubarray(segments, {
              minLength: segments.length,
              maxLength: segments.length,
            }),
            fc.array(fc.boolean(), { minLength: segments.length, maxLength: segments.length }),
          ),
        ),
        (origin, [segments, shuffled, flips]) => {
          const flipped = shuffled.map((s, i) => (flips[i] ? { a: s.b, b: s.a } : s));
          expect(visibilityPolygon(origin, flipped, BOUNDS)).toEqual(
            visibilityPolygon(origin, segments, BOUNDS),
          );
        },
      ),
      PROPS,
    );
  });

  it('puts every vertex on a segment or the bounds', () => {
    fc.assert(
      fc.property(originArb, segmentsArb, (origin, segments) => {
        expectVerticesOnOccluders(
          visibilityPolygon(origin, segments, BOUNDS),
          segments,
          BOUNDS,
          origin,
        );
      }),
      PROPS,
    );
  });
});
