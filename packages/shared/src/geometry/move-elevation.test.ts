import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { moveElevation, topSurfaceAt, type WalkableSurface } from './surface-height.js';

const box = (
  size: [number, number, number],
  pos: [number, number, number] = [0, 0, 0],
): WalkableSurface => ({
  kind: 'box',
  position: { x: pos[0], y: pos[1], z: pos[2] },
  scale: { x: size[0], y: size[1], z: size[2] },
  yaw: 0,
});
const wedge = (size: [number, number, number]): WalkableSurface => ({
  kind: 'wedge',
  position: { x: 0, y: 0, z: 0 },
  scale: { x: size[0], y: size[1], z: size[2] },
  yaw: 0,
});

describe('topSurfaceAt', () => {
  it('is undefined over bare ground and the highest top elsewhere', () => {
    const stack = [box([4, 1, 4]), box([2, 2, 2], [0, 1, 0])];
    expect(topSurfaceAt(9, 9, stack)).toBeUndefined();
    expect(topSurfaceAt(1.5, 0, stack)).toBe(1);
    expect(topSurfaceAt(0, 0, stack)).toBe(3);
  });
});

describe('moveElevation (TOK-03, Q26)', () => {
  it('keeps the elevation with nothing under the cursor, including over bare ground', () => {
    expect(moveElevation({ position: { x: 5, z: 5 }, elevation: 2 }, [])).toBe(2);
    expect(moveElevation({ position: { x: 5, z: 5 }, elevation: 0 }, [box([2, 1, 2])])).toBe(0);
  });

  it('keeps an elevation that no platform justifies (no fall to the ground)', () => {
    expect(moveElevation({ position: { x: 0, z: 0 }, elevation: 2.75 }, [box([4, 1, 4])])).toBe(
      2.75,
    );
  });

  it('takes the exact height of the surface under the cursor, higher or lower than the token', () => {
    const platform = [box([4, 3, 4])];
    expect(
      moveElevation({ position: { x: 0, z: 0 }, elevation: 0, surfaceUnderCursor: 3 }, platform),
    ).toBe(3);
    expect(
      moveElevation({ position: { x: 0, z: 0 }, elevation: 8, surfaceUnderCursor: 3 }, platform),
    ).toBe(3);
  });

  it('resolves stacked platforms to the one the cursor is on, not the one above it', () => {
    const stack = [box([4, 1, 4]), box([4, 1, 4], [0, 3, 0])];
    expect(
      moveElevation({ position: { x: 0, z: 0 }, elevation: 0, surfaceUnderCursor: 1 }, stack),
    ).toBe(1);
    expect(
      moveElevation({ position: { x: 0, z: 0 }, elevation: 0, surfaceUnderCursor: 4 }, stack),
    ).toBe(4);
  });

  it('follows a ramp to the height under the snapped footprint centre', () => {
    const ramp = [wedge([2, 2, 4])]; // rises toward +z: height 2 * (z + 2) / 4
    const h = moveElevation(
      { position: { x: 0, z: 1 }, elevation: 0, surfaceUnderCursor: 1.6 },
      ramp,
    );
    expect(h).toBeCloseTo(1.5);
  });

  it('uses the picked height when the snapped centre falls just off the platform', () => {
    expect(
      moveElevation({ position: { x: 2.2, z: 0 }, elevation: 0, surfaceUnderCursor: 1 }, [
        box([4, 1, 4]),
      ]),
    ).toBe(1);
  });

  it('a flying token ignores surfaces under the cursor', () => {
    expect(
      moveElevation(
        { position: { x: 0, z: 0 }, elevation: 5, flying: true, surfaceUnderCursor: 1 },
        [box([4, 1, 4])],
      ),
    ).toBe(5);
  });

  it('properties: flying never changes height; no pick never changes height', () => {
    const num = fc.double({ min: -50, max: 50, noNaN: true });
    const dim = fc.double({ min: 0.2, max: 10, noNaN: true });
    fc.assert(
      fc.property(num, num, num, dim, dim, num, (x, z, y, w, h, pick) => {
        const w1 = [box([w, h, w]), box([w / 2, h, w / 2], [0, h, 0])];
        const at = { position: { x, z }, elevation: y };
        expect(moveElevation({ ...at, flying: true, surfaceUnderCursor: pick }, w1)).toBe(y);
        expect(moveElevation(at, w1)).toBe(y);
      }),
    );
  });

  it('properties: a picked stacked top always lands exactly on that top', () => {
    const dim = fc.double({ min: 1, max: 5, noNaN: true });
    fc.assert(
      fc.property(dim, dim, dim, (h1, h2, y) => {
        // Walkable tops are at least 1 apart, wider than the 0.5 pick tolerance.
        const stack = [box([4, h1, 4]), box([2, h2, 2], [0, h1, 0])];
        const top = h1 + h2;
        expect(
          moveElevation({ position: { x: 0, z: 0 }, elevation: y, surfaceUnderCursor: top }, stack),
        ).toBeCloseTo(top);
        expect(
          moveElevation({ position: { x: 0, z: 0 }, elevation: y, surfaceUnderCursor: h1 }, stack),
        ).toBeCloseTo(h1);
      }),
    );
  });
});
