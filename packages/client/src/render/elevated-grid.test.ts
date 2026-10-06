import { primitiveProfileHeight } from '@mythic/shared';
import { describe, expect, it } from 'vitest';
import { ELEVATED_GRID_LIFT, elevatedGridSegments, supportsElevatedGrid } from './elevated-grid.js';

const shape = (
  kind: 'box' | 'cylinder' | 'wedge' | 'sphere',
  w: number,
  h: number,
  d: number,
  yaw = 0,
) => ({
  kind,
  width: w,
  height: h,
  depth: d,
  yaw,
  scale: { x: w, y: h, z: d },
});

function segs(arr: Float32Array) {
  const out: number[][] = [];
  for (let i = 0; i < arr.length; i += 6) out.push(Array.from(arr.slice(i, i + 6)));
  return out;
}

describe('elevatedGridSegments (GRID-05)', () => {
  it('supports flat and ramp kinds only', () => {
    expect(supportsElevatedGrid('box')).toBe(true);
    expect(supportsElevatedGrid('wedge')).toBe(true);
    expect(supportsElevatedGrid('sphere')).toBe(false);
    expect(supportsElevatedGrid('cone')).toBe(false);
    expect(elevatedGridSegments(shape('sphere', 3, 3, 3), [5, 0, 5]).length).toBe(0);
  });

  it('draws a box top at its height plus the lift, inside the footprint', () => {
    const s = segs(elevatedGridSegments(shape('box', 4, 2, 3), [10.5, 1, 10.5]));
    expect(s.length).toBeGreaterThan(0);
    for (const [x1, y1, z1, x2, y2, z2] of s as [
      number,
      number,
      number,
      number,
      number,
      number,
    ][]) {
      expect(y1).toBeCloseTo(1 + 2 + ELEVATED_GRID_LIFT, 5);
      expect(y2).toBeCloseTo(y1, 5);
      for (const [x, z] of [
        [x1, z1],
        [x2, z2],
      ] as const) {
        expect(x).toBeGreaterThanOrEqual(8.5 - 1e-4);
        expect(x).toBeLessThanOrEqual(12.5 + 1e-4);
        expect(z).toBeGreaterThanOrEqual(9 - 1e-4);
        expect(z).toBeLessThanOrEqual(12 + 1e-4);
      }
    }
  });

  it('clips cylinder lines to the rotated ellipse', () => {
    const sh = shape('cylinder', 6, 1, 4, 0.6);
    const pos: [number, number, number] = [10, 0, 10];
    const s = segs(elevatedGridSegments(sh, pos));
    expect(s.length).toBeGreaterThan(0);
    for (const seg of s as [number, number, number, number, number, number][]) {
      for (const [x, z] of [
        [seg[0], seg[2]],
        [seg[3], seg[5]],
      ] as const) {
        const h = primitiveProfileHeight(
          {
            kind: 'cylinder',
            position: { x: pos[0], y: 0, z: pos[2] },
            scale: sh.scale,
            yaw: sh.yaw,
          },
          x,
          z,
        );
        // Endpoints lie on the rim; allow a hair outside for float error.
        const nudged = primitiveProfileHeight(
          {
            kind: 'cylinder',
            position: { x: pos[0], y: 0, z: pos[2] },
            scale: sh.scale,
            yaw: sh.yaw,
          },
          x + (pos[0] - x) * 1e-3,
          z + (pos[2] - z) * 1e-3,
        );
        expect(h === undefined ? nudged : h).toBeDefined();
      }
    }
  });

  it('follows the wedge slope', () => {
    const sh = shape('wedge', 4, 2, 4);
    const pos: [number, number, number] = [10, 0, 10];
    for (const seg of segs(elevatedGridSegments(sh, pos)) as [
      number,
      number,
      number,
      number,
      number,
      number,
    ][]) {
      for (const [x, y, z] of [
        [seg[0], seg[1], seg[2]],
        [seg[3], seg[4], seg[5]],
      ] as const) {
        const h = primitiveProfileHeight(
          { kind: 'wedge', position: { x: 10, y: 0, z: 10 }, scale: sh.scale, yaw: 0 },
          x,
          z,
        );
        expect(y).toBeCloseTo((h ?? 0) + ELEVATED_GRID_LIFT, 5);
      }
    }
  });

  it('draws nothing for an absurdly large top', () => {
    expect(elevatedGridSegments(shape('box', 5000, 1, 5000), [0, 0, 0]).length).toBe(0);
  });
});
