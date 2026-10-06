import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Grid } from '../schema/index.js';
import { snapToGrid, UnsupportedGridError } from './snap-to-grid.js';

const squareGrid: Grid = {
  type: 'square',
  sizePx: 70,
  unitsPerCell: 5,
  unitLabel: 'ft',
  diagonal: 'alternating',
  snap: true,
};
const coordinate = fc.double({ min: -1_000, max: 1_000, noNaN: true, noDefaultInfinity: true });
const vec3 = fc.record({ x: coordinate, y: coordinate, z: coordinate });

describe('snapToGrid', () => {
  it('snaps odd footprints to cell centres, including at negative coordinates', () => {
    expect(snapToGrid({ x: -0.2, y: 7, z: 2.9 }, squareGrid)).toEqual({
      x: -0.5,
      y: 7,
      z: 2.5,
    });
  });

  it('snaps even footprints to intersections', () => {
    expect(snapToGrid({ x: -0.6, y: 7, z: 2.5 }, squareGrid, { footprint: 2 })).toEqual({
      x: -1,
      y: 7,
      z: 3,
    });
  });

  it('returns the original position when snapping is disabled', () => {
    const position = { x: 1.2, y: 3.4, z: 5.6 };
    expect(snapToGrid(position, { ...squareGrid, snap: false })).toBe(position);
  });

  it('rejects hex grids with a typed error', () => {
    expect(() => snapToGrid({ x: 0, y: 0, z: 0 }, { ...squareGrid, type: 'hex' })).toThrow(
      UnsupportedGridError,
    );
  });

  it('is idempotent for odd and even footprints', () => {
    fc.assert(
      fc.property(vec3, fc.constantFrom(1, 2, 3, 4), (position, footprint) => {
        const once = snapToGrid(position, squareGrid, { footprint });
        expect(snapToGrid(once, squareGrid, { footprint })).toEqual(once);
      }),
    );
  });
});
