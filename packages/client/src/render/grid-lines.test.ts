import { describe, expect, it } from 'vitest';
import {
  borderSegments,
  clipRangeToBounds,
  gridSegments,
  gridVisible,
  MAX_LINES_PER_AXIS,
  sameRange,
  visibleCellRange,
} from './grid-lines.js';

describe('visibleCellRange', () => {
  it('covers the viewport plus a margin, on integers', () => {
    const r = visibleCellRange({ centerX: 0, centerZ: 0, zoom: 50 }, { width: 500, height: 300 });
    // half extent 5 x 3 cells, margin 2
    expect(r).toEqual({ minX: -7, maxX: 7, minZ: -5, maxZ: 5 });
  });
  it('follows the camera centre and zoom', () => {
    const r = visibleCellRange(
      { centerX: 10.5, centerZ: -3, zoom: 100 },
      { width: 200, height: 200 },
    );
    expect(r.minX).toBe(7);
    expect(r.maxX).toBe(14);
    expect(r.minZ).toBe(-6);
    expect(r.maxZ).toBe(0);
  });
  it('compares ranges', () => {
    const r = visibleCellRange({ centerX: 0, centerZ: 0, zoom: 50 }, { width: 100, height: 100 });
    expect(sameRange(r, { ...r })).toBe(true);
    expect(sameRange(null, r)).toBe(false);
    expect(sameRange(r, { ...r, maxX: r.maxX + 1 })).toBe(false);
  });
});

describe('gridSegments', () => {
  it('emits one segment per integer line on each axis', () => {
    const seg = gridSegments({ minX: 0, maxX: 2, minZ: 0, maxZ: 1 }, 0);
    expect(seg.length).toBe((3 + 2) * 6);
    expect(Array.from(seg.slice(0, 6))).toEqual([0, 0, 0, 0, 0, 1]); // first X line
    expect(Array.from(seg.slice(18, 24))).toEqual([0, 0, 0, 2, 0, 0]); // first Z line
  });
  it('places lines at the requested height', () => {
    const seg = gridSegments({ minX: 0, maxX: 0, minZ: 0, maxZ: 0 }, 1.5);
    expect(seg[1]).toBe(1.5);
  });
  it('returns nothing when the range is too large or empty', () => {
    expect(gridSegments({ minX: 0, maxX: MAX_LINES_PER_AXIS, minZ: 0, maxZ: 1 }).length).toBe(0);
    expect(gridSegments({ minX: 1, maxX: 0, minZ: 0, maxZ: 1 }).length).toBe(0);
  });
});

describe('gridVisible', () => {
  it('hides the grid when cells are tiny or zoom is invalid', () => {
    expect(gridVisible(48)).toBe(true);
    expect(gridVisible(2)).toBe(false);
    expect(gridVisible(Number.NaN)).toBe(false);
  });
});

describe('canvas clipping (D37)', () => {
  const bounds = { width: 4, height: 3 };
  it('clips a viewport range to the canvas', () => {
    expect(clipRangeToBounds({ minX: -7, maxX: 9, minZ: -5, maxZ: 5 }, bounds)).toEqual({
      minX: 0,
      maxX: 4,
      minZ: 0,
      maxZ: 3,
    });
    expect(clipRangeToBounds({ minX: 5, maxX: 9, minZ: 0, maxZ: 3 }, bounds)).toBeNull();
  });
  it('emits only lines inside the canvas', () => {
    const range = clipRangeToBounds({ minX: -7, maxX: 9, minZ: -5, maxZ: 5 }, bounds);
    const seg = gridSegments(range ?? { minX: 1, maxX: 0, minZ: 1, maxZ: 0 });
    for (let i = 0; i < seg.length; i += 3) {
      expect(seg[i]).toBeGreaterThanOrEqual(0);
      expect(seg[i]).toBeLessThanOrEqual(4);
      expect(seg[i + 2]).toBeGreaterThanOrEqual(0);
      expect(seg[i + 2]).toBeLessThanOrEqual(3);
    }
    expect(seg.length).toBe((5 + 4) * 6);
  });
  it('draws a closed border rectangle', () => {
    const b = borderSegments(bounds, 0);
    expect(b.length).toBe(4 * 6);
    expect(Array.from(b.slice(0, 6))).toEqual([0, 0, 0, 4, 0, 0]);
    expect(Array.from(b.slice(18, 24))).toEqual([0, 0, 3, 0, 0, 0]);
  });
});
