import { describe, expect, it } from 'vitest';
import type { Grid, Scene } from '@mythic/shared';
import { formatRulerDistance, measureRuler, prepareRulerPoint } from './ruler.js';

const grid: Grid = {
  type: 'square',
  sizePx: 70,
  unitsPerCell: 5,
  unitLabel: 'ft',
  diagonal: 'alternating',
  snap: true,
};

const scene: Scene = {
  id: 'A'.repeat(26),
  name: 'Measure',
  grid,
  bounds: { width: 10, height: 8 },
  environment: { background: '#000000' },
  layers: {},
  entities: {},
};

describe('2D ruler maths (MEAS-01)', () => {
  it('snaps waypoints to cell centres and clamps them to the scene canvas', () => {
    expect(prepareRulerPoint({ x: 2.2, z: 4.9 }, scene)).toEqual({ x: 2.5, y: 0, z: 4.5 });
    expect(prepareRulerPoint({ x: 20, z: -4 }, scene)).toEqual({ x: 10, y: 0, z: 0 });
    expect(prepareRulerPoint({ x: 2.2, z: 4.9 }, { ...scene, grid: { ...grid, snap: false } })).toEqual(
      { x: 2.2, y: 0, z: 4.9 },
    );
  });

  it('uses the diagonal rule per segment and sums in scene units', () => {
    const measured = measureRuler(
      [
        { x: 0, y: 0, z: 0 },
        { x: 3, y: 0, z: 4 },
        { x: 6, y: 0, z: 8 },
      ],
      grid,
    );
    expect(measured.segments.map((segment) => segment.cells)).toEqual([5, 5]);
    expect(measured.segments.map((segment) => segment.label)).toEqual(['25 ft', '25 ft']);
    expect(measured.totalLabel).toBe('50 ft');
  });

  it('formats fractional scene units without noisy floating point tails', () => {
    expect(formatRulerDistance(1.25, { unitsPerCell: 5, unitLabel: 'ft' })).toBe('6.25 ft');
    expect(formatRulerDistance(Math.sqrt(2), { unitsPerCell: 1, unitLabel: '' })).toBe('1.41');
  });
});

