import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../schema/index.js';
import { distance, toSceneUnits, type DistanceRule } from './distance.js';

const rules = ['chebyshev', 'alternating', 'euclidean', 'manhattan'] as const;
const coordinate = fc.double({ min: -1_000, max: 1_000, noNaN: true, noDefaultInfinity: true });
const vec3 = fc.record({ x: coordinate, y: coordinate, z: coordinate });

describe('distance', () => {
  it.each<[DistanceRule, number, number, number]>([
    ['chebyshev', 4, 6, 6],
    ['alternating', 5, 6, 9],
    ['euclidean', 5, 6, Math.sqrt(61)],
    ['manhattan', 7, 6, 13],
  ])('measures a 3D displacement using %s', (rule, horizontal, vertical, total) => {
    expect(distance({ x: 0, y: 0, z: 0 }, { x: 3, y: 6, z: 4 }, rule)).toEqual({
      horizontal,
      vertical,
      total,
    });
  });

  it('converts cells to scene units without using pixel size', () => {
    expect(toSceneUnits(3.5, { unitsPerCell: 5 })).toBe(17.5);
  });

  it('is symmetric, non-negative, and zero for identical points', () => {
    fc.assert(
      fc.property(vec3, vec3, fc.constantFrom(...rules), (a, b, rule) => {
        const forward = distance(a, b, rule);
        const reverse = distance(b, a, rule);

        expect(forward).toEqual(reverse);
        expect(forward.horizontal).toBeGreaterThanOrEqual(0);
        expect(forward.vertical).toBeGreaterThanOrEqual(0);
        expect(forward.total).toBeGreaterThanOrEqual(0);
        expect(forward.total).toBeGreaterThanOrEqual(forward.horizontal);
        expect(forward.total).toBeGreaterThanOrEqual(forward.vertical);
        expect(distance(a, a, rule)).toEqual({ horizontal: 0, vertical: 0, total: 0 });
      }),
    );
  });

  it('orders Manhattan at least Euclidean at least Chebyshev', () => {
    fc.assert(
      fc.property(vec3, vec3, (a: Vec3, b: Vec3) => {
        const manhattan = distance(a, b, 'manhattan');
        const euclidean = distance(a, b, 'euclidean');
        const chebyshev = distance(a, b, 'chebyshev');

        expect(manhattan.horizontal).toBeGreaterThanOrEqual(euclidean.horizontal);
        expect(euclidean.horizontal).toBeGreaterThanOrEqual(chebyshev.horizontal);
        expect(manhattan.total).toBeGreaterThanOrEqual(euclidean.total);
        expect(euclidean.total).toBeGreaterThanOrEqual(chebyshev.total);
      }),
    );
  });
});
