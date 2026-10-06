import { PRIMITIVE_KINDS } from '@mythic/shared';
import { describe, expect, it } from 'vitest';
import { footprintFill, safeColor, shapeFootprint, unitGeometry } from './primitive-geometry.js';

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

  it('falls back for unparseable colours', () => {
    expect(safeColor('#a52')).toBe('#a52');
    expect(safeColor('not-a-colour')).toBe('#8a96a5');
  });
});
