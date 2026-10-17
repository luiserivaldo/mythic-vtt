import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { isSimplePolygon, localToWorldXZ, segmentsIntersect } from './polygon.js';
import { yawFromQuaternion } from './primitives.js';

const p = (x: number, z: number) => ({ x, z });

describe('segmentsIntersect', () => {
  it('detects crossings and touches, and rejects disjoint and parallel segments', () => {
    expect(segmentsIntersect(p(0, 0), p(2, 2), p(0, 2), p(2, 0))).toBe(true);
    expect(segmentsIntersect(p(0, 0), p(2, 0), p(2, 0), p(3, 1))).toBe(true);
    expect(segmentsIntersect(p(0, 0), p(2, 0), p(1, 0), p(3, 0))).toBe(true);
    expect(segmentsIntersect(p(0, 0), p(1, 0), p(2, 0), p(3, 0))).toBe(false);
    expect(segmentsIntersect(p(0, 0), p(2, 0), p(0, 1), p(2, 1))).toBe(false);
  });
});

describe('isSimplePolygon', () => {
  it('accepts triangles, rectangles and concave rings', () => {
    expect(isSimplePolygon([p(0, 0), p(1, 0), p(0, 1)])).toBe(true);
    expect(isSimplePolygon([p(0, 0), p(4, 0), p(4, 3), p(0, 3)])).toBe(true);
    expect(isSimplePolygon([p(0, 0), p(4, 0), p(4, 4), p(2, 1), p(0, 4)])).toBe(true);
    // A redundant collinear vertex is harmless.
    expect(isSimplePolygon([p(0, 0), p(2, 0), p(4, 0), p(4, 3), p(0, 3)])).toBe(true);
  });

  it('rejects bow-ties, too few or repeated points, zero area and edges folding back', () => {
    expect(isSimplePolygon([p(0, 0), p(2, 2), p(2, 0), p(0, 2)])).toBe(false);
    expect(isSimplePolygon([p(0, 0), p(1, 0)])).toBe(false);
    expect(isSimplePolygon([p(0, 0), p(1, 0), p(1, 0), p(0, 1)])).toBe(false);
    expect(isSimplePolygon([p(0, 0), p(1, 0), p(2, 0)])).toBe(false);
    expect(isSimplePolygon([p(0, 0), p(4, 0), p(2, 0), p(2, 3)])).toBe(false);
    // A vertex touching a non-adjacent edge.
    expect(isSimplePolygon([p(0, 0), p(4, 0), p(4, 4), p(2, 0), p(0, 4)])).toBe(false);
  });
});

describe('localToWorldXZ (D47 local frame)', () => {
  it('translates without yaw and rotates in the primitiveFootprint sense', () => {
    expect(localToWorldXZ({ x: 3, z: 4 }, 0, p(1, 2))).toEqual(p(4, 6));
    // A quarter turn about +Y (three.js): local +X goes to world -Z.
    const yaw = yawFromQuaternion({ x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 });
    const world = localToWorldXZ({ x: 0, z: 0 }, yaw, p(1, 0));
    expect(world.x).toBeCloseTo(0);
    expect(world.z).toBeCloseTo(-1);
  });

  it('preserves distances between points (rotation plus translation)', () => {
    const coord = fc.double({ min: -1000, max: 1000, noNaN: true });
    fc.assert(
      fc.property(
        coord,
        coord,
        fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
        coord,
        coord,
        (px, pz, yaw, x, z) => {
          const a = localToWorldXZ({ x: px, z: pz }, yaw, p(0, 0));
          const b = localToWorldXZ({ x: px, z: pz }, yaw, p(x, z));
          expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeCloseTo(Math.hypot(x, z), 6);
        },
      ),
    );
  });
});
