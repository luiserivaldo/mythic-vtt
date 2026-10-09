import { describe, expect, it } from 'vitest';
import { AOE_CELL_INSET, cellHighlightTransform } from './AoEHighlights.js';

describe('AoE affected cell visuals (M3-12)', () => {
  const cell = { x: 2, y: 3, z: 4 };

  it('keeps the 2D highlight flat on the cell floor', () => {
    expect(cellHighlightTransform(cell, '2d')).toEqual({
      position: [2.5, 3.012, 4.5],
      rotationX: -Math.PI / 2,
    });
  });

  it('centres the 3D volume inside the full affected cell', () => {
    expect(cellHighlightTransform(cell, '3d')).toEqual({
      position: [2.5, 3.5, 4.5],
      rotationX: 0,
    });
    expect(AOE_CELL_INSET).toBeGreaterThan(0);
    expect(AOE_CELL_INSET).toBeLessThan(1);
  });
});
