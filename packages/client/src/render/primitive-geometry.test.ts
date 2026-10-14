import { PRIMITIVE_KINDS } from '@mythic/shared';
import { describe, expect, it } from 'vitest';
import {
  footprintFill,
  safeColor,
  shapeFootprint,
  textureTiling,
  unitGeometry,
} from './primitive-geometry.js';

describe('unit primitive geometries', () => {
  it('sit on y = 0 inside the unit footprint for every kind', () => {
    for (const kind of PRIMITIVE_KINDS) {
      const g = unitGeometry(kind);
      g.computeBoundingBox();
      const box = g.boundingBox;
      expect(box?.min.y).toBeCloseTo(0);
      expect(box?.max.y).toBeCloseTo(1);
      expect(Math.abs(box?.min.x ?? 9)).toBeLessThanOrEqual(0.5 + 1e-6);
      expect(Math.abs(box?.max.z ?? 9)).toBeLessThanOrEqual(0.5 + 1e-6);
      expect(unitGeometry(kind)).toBe(g);
    }
  });

  it('fills a footprint as a triangle fan', () => {
    const shape = {
      kind: 'box' as const,
      color: '#fff',
      walkable: true,
      showGridOnTop: false,
      width: 2,
      height: 1,
      depth: 2,
      yaw: 0,
      scale: { x: 2, y: 1, z: 2 },
    };
    const fill = footprintFill(shapeFootprint(shape));
    expect(fill.index?.count).toBe(6);
  });

  it('tiles a texture once per cell, and one tile when the size is degenerate (ENV-05)', () => {
    expect(textureTiling({ width: 2, depth: 3 })).toEqual({ x: 2, y: 3 });
    expect(textureTiling({ width: 2.5, depth: 0.4 })).toEqual({ x: 2.5, y: 1 });
    expect(textureTiling({ width: 1, depth: 1 })).toEqual({ x: 1, y: 1 });
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -4]) {
      expect(textureTiling({ width: bad, depth: bad })).toEqual({ x: 1, y: 1 });
    }
  });

  it('gives the 2D fill one cell-space UV per vertex, v negated like a battlemap', () => {
    const points = [
      { x: 1, z: 2 },
      { x: 1, z: 4 },
      { x: 2, z: 4 },
      { x: 2, z: 2 },
    ];
    const uv = footprintFill(points).getAttribute('uv');
    expect(uv.count).toBe(points.length);
    expect(Array.from(uv.array as Float32Array)).toEqual([1, -2, 1, -4, 2, -4, 2, -2]);
  });

  it('falls back for unparseable colours', () => {
    expect(safeColor('#a52')).toBe('#a52');
    expect(safeColor('not-a-colour')).toBe('#8a96a5');
  });
});
