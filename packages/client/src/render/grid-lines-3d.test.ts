import { describe, expect, it } from 'vitest';
import { gridSegments } from './grid-lines.js';
import {
  CHUNK_CELLS,
  gridSegmentsChunked,
  MAX_HALF_EXTENT,
  perspectiveGridRange,
} from './grid-lines-3d.js';

describe('perspectiveGridRange', () => {
  it('centres on the ground point the camera looks at', () => {
    const r = perspectiveGridRange({ x: 10, y: 10, z: 0 }, { x: 0, y: -1, z: 0 });
    expect((r.minX + r.maxX) / 2).toBeCloseTo(10, 0);
    expect((r.minZ + r.maxZ) / 2).toBeCloseTo(0, 0);
  });

  it('always yields a drawable grid, even for a very distant camera', () => {
    const r = perspectiveGridRange({ x: 0, y: 5000, z: 0 }, { x: 0, y: -1, z: 0 });
    expect(r.maxX - r.minX).toBeLessThanOrEqual(2 * MAX_HALF_EXTENT + 8);
    expect(gridSegments(r).length).toBeGreaterThan(0);
  });

  it('falls back to below the camera when looking at or above the horizon', () => {
    const r = perspectiveGridRange({ x: 3, y: 4, z: 5 }, { x: 0, y: 1, z: 0 });
    expect(r.minX).toBeLessThanOrEqual(3);
    expect(r.maxX).toBeGreaterThanOrEqual(3);
  });
});

describe('gridSegmentsChunked', () => {
  it('covers the same lines as gridSegments, in short pieces', () => {
    const range = { minX: -40, maxX: 40, minZ: -20, maxZ: 20 };
    const out = gridSegmentsChunked(range);
    expect(out.length % 6).toBe(0);
    let longest = 0;
    for (let i = 0; i < out.length; i += 6) {
      const len = Math.hypot(
        (out[i + 3] ?? 0) - (out[i] ?? 0),
        (out[i + 5] ?? 0) - (out[i + 2] ?? 0),
      );
      longest = Math.max(longest, len);
    }
    expect(longest).toBeLessThanOrEqual(CHUNK_CELLS + 1);
    // The pieces of each line add up to the original line lengths.
    let total = 0;
    for (let i = 0; i < out.length; i += 6)
      total += Math.hypot((out[i + 3] ?? 0) - (out[i] ?? 0), (out[i + 5] ?? 0) - (out[i + 2] ?? 0));
    const whole = gridSegments(range);
    let wholeTotal = 0;
    for (let i = 0; i < whole.length; i += 6)
      wholeTotal += Math.hypot(
        (whole[i + 3] ?? 0) - (whole[i] ?? 0),
        (whole[i + 5] ?? 0) - (whole[i + 2] ?? 0),
      );
    expect(total).toBeCloseTo(wholeTotal, 5);
  });

  it('is empty when the range is over the line cap', () => {
    expect(gridSegmentsChunked({ minX: 0, maxX: 500, minZ: 0, maxZ: 5 }).length).toBe(0);
  });
});
