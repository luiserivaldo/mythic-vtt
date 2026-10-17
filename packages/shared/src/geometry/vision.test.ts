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
  VISION_NUDGE,
  visionOccluders,
  visionOrigin,
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
  const dx = q.x - s.a.x - t * ex;
  const dz = q.z - s.a.z - t * ez;
  return Math.sqrt(dx * dx + dz * dz);
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

  it('an origin in the middle of a wall sees exactly one side', () => {
    const walls = [seg(5, 10, 15, 10)];
    const origin = p(10, 10);
    // Arms at -pi and 0 leave two half-turn gaps; the tie goes to the one starting at -pi, so
    // the eye moves towards -Z.
    const eye = visionOrigin(origin, walls, BOUNDS);
    expect(eye?.x).toBeCloseTo(10, 12);
    expect(eye?.z).toBeCloseTo(10 - VISION_NUDGE, 12);
    const poly = visibilityPolygon(origin, walls, BOUNDS);
    expectWellFormed(poly);
    expect(pointInPolygon(origin, poly)).toBe(true);
    expect(pointInPolygon(p(10, 2), poly)).toBe(true);
    expect(pointInPolygon(p(10, 18), poly)).toBe(false);
    expect(pointInPolygon(p(2, 15), poly)).toBe(false);
    expect(pointInPolygon(p(18, 15), poly)).toBe(false);
    // The z < 10 half, plus slivers past the wall's ends no wider than the nudge.
    expect(area(poly)).toBeCloseTo(200, 4);
  });

  it('an origin on a room corner sees the outside 270 degrees only', () => {
    const walls = rect(5, 5, 10, 10);
    for (const [origin, hiddenArea] of [
      [p(5, 5), 225], // everything beyond the room, x > 5 and z > 5, is behind it
      [p(10, 10), 100],
    ] as const) {
      const poly = visibilityPolygon(origin, walls, BOUNDS);
      expectWellFormed(poly);
      expect(pointInPolygon(origin, poly)).toBe(true);
      expect(pointInPolygon(p(7, 7), poly)).toBe(false); // inside the room
      expect(pointInPolygon(p(9.9, 5.1), poly)).toBe(false);
      expect(area(poly)).toBeCloseTo(400 - hiddenArea, 4);
    }
    expect(sees(p(5, 5), walls, p(3, 3))).toBe(true);
    expect(sees(p(5, 5), walls, p(15, 3))).toBe(true);
    expect(sees(p(5, 5), walls, p(3, 15))).toBe(true);
    expect(sees(p(5, 5), walls, p(15, 15))).toBe(false);
    expect(sees(p(10, 10), walls, p(15, 15))).toBe(true);
    expect(sees(p(10, 10), walls, p(3, 3))).toBe(false);
  });

  it('an origin on a T-junction sees only its open 180 degrees', () => {
    const walls = [seg(6, 12, 14, 12), seg(10, 12, 10, 8)];
    const origin = p(10, 12);
    const poly = visibilityPolygon(origin, walls, BOUNDS);
    expectWellFormed(poly);
    expect(pointInPolygon(origin, poly)).toBe(true);
    expect(pointInPolygon(p(10, 18), poly)).toBe(true);
    expect(pointInPolygon(p(2, 18), poly)).toBe(true);
    expect(pointInPolygon(p(9, 11), poly)).toBe(false);
    expect(pointInPolygon(p(11, 11), poly)).toBe(false);
    expect(area(poly)).toBeCloseTo(160, 4);
  });

  it('an origin on crossing walls sees one deterministic quadrant', () => {
    const walls = [seg(5, 5, 15, 15), seg(5, 15, 15, 5)];
    const origin = p(10, 10);
    const poly = visibilityPolygon(origin, walls, BOUNDS);
    expectWellFormed(poly);
    expect(pointInPolygon(origin, poly)).toBe(true);
    // Four quarter-turn gaps; the first, from -3pi/4, opens towards -Z.
    expect(pointInPolygon(p(10, 6), poly)).toBe(true);
    expect(pointInPolygon(p(3, 1), poly)).toBe(true);
    expect(pointInPolygon(p(10, 14), poly)).toBe(false);
    expect(pointInPolygon(p(6, 10), poly)).toBe(false);
    expect(pointInPolygon(p(14, 10), poly)).toBe(false);
  });

  it('an origin on a free wall tip or a door jamb still sees past it on both sides', () => {
    const tip = [seg(5, 10, 10, 10)];
    const fromTip = visibilityPolygon(p(10, 10), tip, BOUNDS);
    expectWellFormed(fromTip);
    expect(pointInPolygon(p(10, 10), fromTip)).toBe(true);
    expect(pointInPolygon(p(7, 15), fromTip)).toBe(true);
    expect(pointInPolygon(p(7, 5), fromTip)).toBe(true);
    // The eye moves straight away from the wall, so the wall is exactly edge-on.
    expect(area(fromTip)).toBeCloseTo(400, 9);

    // The door from 'a room with a one-cell door gap', origin on the lower jamb's end.
    const walls = [
      seg(5, 5, 10, 5),
      seg(10, 5, 10, 7),
      seg(10, 8, 10, 10),
      seg(10, 10, 5, 10),
      seg(5, 10, 5, 5),
    ];
    const jamb = p(10, 7);
    const poly = visibilityPolygon(jamb, walls, BOUNDS);
    expectWellFormed(poly);
    expect(pointInPolygon(jamb, poly)).toBe(true);
    expect(pointInPolygon(p(7.5, 7.5), poly)).toBe(true); // inside the room
    expect(pointInPolygon(p(6, 9), poly)).toBe(true);
    expect(pointInPolygon(p(15, 7.5), poly)).toBe(true); // outside, through the door
    expect(pointInPolygon(p(15, 2), poly)).toBe(true);
    expect(pointInPolygon(p(2, 7.5), poly)).toBe(false); // beyond the room's far wall
  });

  it('is blind, never both sides, when the nudge would cross or land on another wall', () => {
    const wall = seg(5, 10, 15, 10);
    const origin = p(10, 10);
    // The eye would move to (10, 10 - 1e-6), across a wall half a nudge below the first.
    for (const other of [
      seg(9, 10 - VISION_NUDGE / 2, 11, 10 - VISION_NUDGE / 2),
      seg(9, 10 - VISION_NUDGE, 11, 10 - VISION_NUDGE),
    ]) {
      expect(visionOrigin(origin, [wall, other], BOUNDS)).toBeNull();
      expect(visibilityPolygon(origin, [wall, other], BOUNDS)).toEqual([]);
    }
    // A wall the hop does not reach changes nothing.
    const far = seg(9, 9, 11, 9);
    expect(visionOrigin(origin, [wall, far], BOUNDS)).toEqual(visionOrigin(origin, [wall], BOUNDS));
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
    // On the outline is not inside (strict interior): the outline stays and blocks.
    expect(visionOccluders(p(10, 8), occluders)).toEqual([
      ...polygonSegments(prop),
      ...polygonSegments(pillar),
    ]);
    // From outside, the prop blocks.
    const outside = p(2, 8);
    expect(sees(outside, visionOccluders(outside, occluders), p(12, 8))).toBe(false);
    expect(
      visionOccluders(outside, [{ kind: 'segments', segments: [seg(1, 1, 2, 2)] }, ...occluders]),
    ).toHaveLength(9);
  });

  it('a token on a pillar edge or corner does not see through the pillar', () => {
    const pillar = [p(14, 7.5), p(15, 7.5), p(15, 8.5), p(14, 8.5)];
    const occluders = [{ kind: 'footprint' as const, outline: pillar }];
    const look = (origin: Point2) => {
      const walls = visionOccluders(origin, occluders);
      expect(walls).toEqual(polygonSegments(pillar));
      const poly = visibilityPolygon(origin, walls, BOUNDS);
      expectWellFormed(poly);
      expect(pointInPolygon(origin, poly)).toBe(true);
      return poly;
    };
    // Far edge: the half-turn tie opens towards +X, away from the pillar.
    const edge = look(p(15, 8));
    expect(pointInPolygon(p(18, 8), edge)).toBe(true);
    expect(pointInPolygon(p(12, 8), edge)).toBe(false);
    // Corner: the outside 270 degrees; the diagonal through the pillar stays hidden.
    const corner = look(p(14, 7.5));
    expect(pointInPolygon(p(12, 5), corner)).toBe(true);
    expect(pointInPolygon(p(16, 9.5), corner)).toBe(false);
    // Near edge: the same tie opens towards +X, into the pillar, so it sees only the pillar.
    const near = look(p(14, 8));
    expect(pointInPolygon(p(18, 8), near)).toBe(false);
    expect(pointInPolygon(p(12, 8), near)).toBe(false);
    expect(area(near)).toBeCloseTo(1, 4);
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

  it('gives an AoE its centre and its rotated 3D box corners, projected to XZ', () => {
    expect(
      sightSamples({
        transform: transform(4, 6),
        aoe: { kind: 'sphere', radius: 2, color: '#f00' },
      }),
    ).toEqual([p(4, 6), p(2, 4), p(6, 4), p(2, 8), p(6, 8)]);
    expect(
      sightSamples({
        transform: transform(0, 0),
        aoe: { kind: 'line', length: 6, width: 1, height: 1, color: '#f00' },
      }),
    ).toEqual([p(0, 0), p(-0.5, 0), p(0.5, 0), p(-0.5, 6), p(0.5, 6)]);
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

  it('rotates AoE samples by pitch and roll too, as aoe.ts rotates the shape', () => {
    const turned = (x: number, z: number, axis: 'x' | 'z', angle: number) => ({
      position: { x, y: 3, z },
      rotation: {
        x: axis === 'x' ? Math.sin(angle / 2) : 0,
        y: 0,
        z: axis === 'z' ? Math.sin(angle / 2) : 0,
        w: Math.cos(angle / 2),
      },
      scale: { x: 1, y: 1, z: 1 },
    });
    // A cone pitched straight down (+Z turned to -Y) projects to a disc: every sample stays
    // within its radius of the position in X and Z, nowhere near its length along +Z.
    const down = sightSamples({
      transform: turned(4, 6, 'x', Math.PI / 2),
      aoe: { kind: 'cone', radius: 1.5, length: 8, color: '#f00' },
    });
    expect(down[0]).toEqual(p(4, 6));
    expect(down.length).toBeGreaterThan(4);
    for (const q of down) {
      expect(Math.abs(q.x - 4)).toBeLessThanOrEqual(1.5 + 1e-9);
      expect(Math.abs(q.z - 6)).toBeLessThanOrEqual(1.5 + 1e-9);
    }
    // A line rolled a quarter turn about its own axis swaps width and height in XZ.
    const rolled = sightSamples({
      transform: turned(0, 0, 'z', Math.PI / 2),
      aoe: { kind: 'line', length: 6, width: 1, height: 3, color: '#f00' },
    });
    expect(Math.max(...rolled.map((q) => q.x))).toBeCloseTo(1.5, 9);
    expect(Math.min(...rolled.map((q) => q.x))).toBeCloseTo(-1.5, 9);
    expect(Math.max(...rolled.map((q) => q.z))).toBeCloseTo(6, 9);
    expect(Math.min(...rolled.map((q) => q.z))).toBeCloseTo(0, 9);
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

// Sample points drawn per run from the fast-check seed, so a failure replays. Uniform over the
// bounds: fc.double is uniform over float bit patterns and biased arbitraries favour their
// extremes, either of which crowds samples against the bounds edge.
const uniform = fc.noBias(fc.nat({ max: 2 ** 31 - 1 })).map((n) => (n / 2 ** 31) * 20);
const sampleArb = fc.record({ x: uniform, z: uniform });
const samplesArb = fc.array(sampleArb, { minLength: 200, maxLength: 200 });

// Origins exactly on a segment: an endpoint (t = 0 or 1) or a random point along it.
const onSegmentArb = fc
  .tuple(
    fc.array(segmentArb, { minLength: 1, maxLength: 24 }),
    fc.nat(),
    fc.oneof(fc.constant(0), fc.constant(1), fc.double({ min: 0, max: 1, noNaN: true })),
  )
  .map(([segments, pick, t]) => {
    const s = segments[pick % segments.length] as Segment;
    const origin = t === 1 ? s.b : p(s.a.x + t * (s.b.x - s.a.x), s.a.z + t * (s.b.z - s.a.z));
    return { origin, segments };
  });

/** Sight lines this close to a wall endpoint, in radians seen from the eye, are ambiguous. */
const GRAZE_ANGLE = 1e-8;
/** Sample points this close to a wall or the bounds, in cells, are ambiguous. */
const NEAR = 1e-7;

/**
 * Brute-force line of sight from `eye`, with no exemption for any wall: q is hidden when the open
 * segment eye -> q properly crosses a wall. Returns undefined only where the answer is decided by
 * the boundary rules rather than by geometry:
 * - q within NEAR of a wall or the bounds (on a wall, the boundary counts as inside);
 * - the sight line passes within GRAZE_ANGLE of a wall endpoint between the eye and q, and no other
 *   wall clearly blocks it. Whether a line exactly through a vertex is blocked depends on the
 *   vertex (an L-corner blocks, a free tip does not), and the sweep merges event rays within
 *   VISION_EPSILON radians, so lines this close to a vertex are not comparable. The tolerance is
 *   angular because the sweep's own error is angular: an eye nudged 1e-6 off a wall has that
 *   wall's endpoint 1e-6 away, and a distance tolerance would skip a wide cone behind it.
 */
function bruteSees(
  eye: Point2,
  segments: readonly Segment[],
  q: Point2,
  bounds = BOUNDS,
): boolean | undefined {
  const sx = q.x - eye.x;
  const sz = q.z - eye.z;
  const sightLength = Math.sqrt(sx * sx + sz * sz);
  const cross = (o: Point2, a: Point2, b: Point2) =>
    (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const grazes = (e: Point2) => {
    const ex = e.x - eye.x;
    const ez = e.z - eye.z;
    const length = Math.sqrt(ex * ex + ez * ez);
    return (
      ex * sx + ez * sz > 0 &&
      length <= sightLength + NEAR &&
      Math.abs(ex * sz - ez * sx) <= GRAZE_ANGLE * length * sightLength
    );
  };
  let ambiguous =
    q.x - bounds.minX < NEAR ||
    bounds.maxX - q.x < NEAR ||
    q.z - bounds.minZ < NEAR ||
    bounds.maxZ - q.z < NEAR;
  for (const w of segments) {
    if (Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z) <= 1e-9) continue;
    if (distToSegment(q, w) < NEAR || grazes(w.a) || grazes(w.b)) {
      ambiguous = true;
      continue;
    }
    const d1 = cross(w.a, w.b, eye);
    const d2 = cross(w.a, w.b, q);
    const d3 = cross(eye, q, w.a);
    const d4 = cross(eye, q, w.b);
    if (d1 * d2 < 0 && d3 * d4 < 0) return false;
  }
  return ambiguous ? undefined : true;
}

const perimeter = (poly: readonly Point2[]) =>
  polygonSegments(poly).reduce((sum, s) => sum + Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z), 0);

/** Origins are on a wall or the bounds edge when within epsilon of one. */
const onSomething = (origin: Point2, segments: readonly Segment[]) =>
  [...segments, ...boundsEdges(BOUNDS)].some(
    (s) => Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z) > 0 && distToSegment(origin, s) <= 1e-9,
  );

describe('visibilityPolygon: properties', () => {
  it('contains its origin and is well formed', () => {
    fc.assert(
      fc.property(originArb, segmentsArb, (origin, segments) => {
        const poly = visibilityPolygon(origin, segments, BOUNDS);
        // Blind only through the visionOrigin fallback, which needs a wall within the nudge of
        // the origin that it does not touch. Integer walls are never that close to a half-cell
        // point (a nonzero distance is at least 0.5 / 28 cells), so these origins always see.
        expect(visionOrigin(origin, segments, BOUNDS)).not.toBeNull();
        expectWellFormed(poly);
        expect(pointInPolygon(origin, poly)).toBe(true);
      }),
      PROPS,
    );
  });

  it('agrees with a brute-force line-of-sight check from the vision origin', () => {
    fc.assert(
      fc.property(originArb, segmentsArb, samplesArb, (origin, segments, samples) => {
        const eye = visionOrigin(origin, segments, BOUNDS);
        expect(eye).not.toBeNull();
        if (!eye) return;
        const poly = visibilityPolygon(origin, segments, BOUNDS);
        for (const q of samples) {
          const expected = bruteSees(eye, segments, q);
          if (expected !== undefined) expect(pointInPolygon(q, poly)).toBe(expected);
        }
      }),
      PROPS,
    );
  });

  it('matches a fine brute-force grid point by point and in area', () => {
    const h = 0.125;
    const cells = 20 / h;
    fc.assert(
      fc.property(originArb, segmentsArb, (origin, segments) => {
        const eye = visionOrigin(origin, segments, BOUNDS);
        if (!eye) return;
        const poly = visibilityPolygon(origin, segments, BOUNDS);
        let visible = 0;
        let ambiguous = 0;
        const mismatches: Point2[] = [];
        for (let i = 0; i < cells; i++) {
          for (let j = 0; j < cells; j++) {
            const q = p((i + 0.5) * h, (j + 0.5) * h);
            const expected = bruteSees(eye, segments, q);
            if (expected === undefined) {
              ambiguous++;
              continue;
            }
            if (expected) visible++;
            // One assertion per run: expect() per point costs more than the geometry.
            if (pointInPolygon(q, poly) !== expected) mismatches.push(q);
          }
        }
        expect(mismatches).toEqual([]);
        // Counting cell centres misjudges only the h x h cells the region's boundary passes
        // through. A boundary piece of length l meets at most sqrt(2) l / h + 2 cells, so if the
        // polygon is the visible region the count is off by at most sqrt(2) h P + 2 n h^2 (P its
        // perimeter, n its edges), plus the ambiguous cells. A leak adds its area to one side but
        // only its outline to the bound.
        const tolerance =
          Math.SQRT2 * h * perimeter(poly) + 2 * poly.length * h * h + ambiguous * h * h;
        expect(Math.abs(visible * h * h - area(poly))).toBeLessThanOrEqual(tolerance);
      }),
      { seed: 296, numRuns: 40 },
    );
  });

  it('an origin on a segment sees nothing its nudged eye cannot, with no exemptions', () => {
    fc.assert(
      fc.property(onSegmentArb, samplesArb, ({ origin, segments }, samples) => {
        const poly = visibilityPolygon(origin, segments, BOUNDS);
        const eye = visionOrigin(origin, segments, BOUNDS);
        if (!eye) {
          expect(poly).toEqual([]);
          // The fallback fires only for a wall the origin does not touch but the nudge reaches.
          expect(
            segments.some((s) => {
              const d = distToSegment(origin, s);
              return d > 1e-9 && d <= VISION_NUDGE + 1e-9;
            }),
          ).toBe(true);
          return;
        }
        expect(onSomething(origin, segments)).toBe(true);
        expect(Math.hypot(eye.x - origin.x, eye.z - origin.z)).toBeCloseTo(VISION_NUDGE, 12);
        expectWellFormed(poly);
        expect(pointInPolygon(origin, poly)).toBe(true);
        for (const q of [...grid, ...samples]) {
          if (pointInPolygon(q, poly)) expect(bruteSees(eye, segments, q)).not.toBe(false);
        }
      }),
      { seed: 296, numRuns: 500 },
    );
  });

  it('never grows when a segment that does not touch the origin is added', () => {
    fc.assert(
      fc.property(originArb, segmentsArb, segmentArb, (origin, segments, extra) => {
        // A segment through the origin adds arms, which can move the eye to another side (a
        // corner origin flips from seeing everything to seeing one quadrant's complement), so
        // monotonicity only holds for segments that leave the eye where it was.
        fc.pre(distToSegment(origin, extra) > 1e-9);
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
