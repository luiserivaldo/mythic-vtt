import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { clampToBounds, isWithinBounds } from './bounds.js';

const b = { width: 10, height: 6 };

describe('isWithinBounds (D37)', () => {
  it('accepts interior and edges, rejects outside and non-finite', () => {
    expect(isWithinBounds(b, { x: 5, z: 3 })).toBe(true);
    expect(isWithinBounds(b, { x: 0, z: 0 })).toBe(true);
    expect(isWithinBounds(b, { x: 10, z: 6 })).toBe(true);
    expect(isWithinBounds(b, { x: 10.01, z: 3 })).toBe(false);
    expect(isWithinBounds(b, { x: 5, z: -0.01 })).toBe(false);
    expect(isWithinBounds(b, { x: Number.NaN, z: 1 })).toBe(false);
  });
});

describe('clampToBounds (D37)', () => {
  it('keeps y and clamps x/z', () => {
    expect(clampToBounds(b, { x: -3, y: 2, z: 99 })).toEqual({ x: 0, y: 2, z: 6 });
  });
  it('always lands within bounds', () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true }), fc.double({ noNaN: true }), (x, z) => {
        expect(isWithinBounds(b, clampToBounds(b, { x, z }))).toBe(true);
      }),
    );
  });
});
