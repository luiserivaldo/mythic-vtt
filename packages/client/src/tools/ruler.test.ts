import { describe, expect, it } from 'vitest';
import type { Grid, Scene } from '@mythic/shared';
import {
  appendWaypoint,
  formatRulerDistance,
  measureRuler,
  MAX_RULER_POINTS,
  prepareRulerPoint,
  rulerDragStarted,
  rulerExpired,
  rulerOwnerName,
  shouldSendRuler,
  withCursor,
} from './ruler.js';

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
    expect(
      prepareRulerPoint({ x: 2.2, z: 4.9 }, { ...scene, grid: { ...grid, snap: false } }),
    ).toEqual({ x: 2.2, y: 0, z: 4.9 });
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

  it('reports horizontal, vertical and total distance for a vertical 3D segment', () => {
    const measured = measureRuler(
      [
        { x: 2, y: 0, z: 3 },
        { x: 2, y: 10, z: 3 },
      ],
      grid,
    );
    expect(measured.segments[0]).toMatchObject({
      horizontalCells: 0,
      verticalCells: 10,
      cells: 10,
      horizontalLabel: '0 ft',
      verticalLabel: '50 ft',
      label: '50 ft',
    });
    expect(measured).toMatchObject({
      horizontalCells: 0,
      verticalCells: 10,
      totalCells: 10,
      horizontalLabel: '0 ft',
      verticalLabel: '50 ft',
      totalLabel: '50 ft',
    });
  });

  it('formats fractional scene units without noisy floating point tails', () => {
    expect(formatRulerDistance(1.25, { unitsPerCell: 5, unitLabel: 'ft' })).toBe('6.25 ft');
    expect(formatRulerDistance(Math.sqrt(2), { unitsPerCell: 1, unitLabel: '' })).toBe('1.41');
  });
});

describe('ruler path helpers (MEAS-01)', () => {
  const a = { x: 1, y: 0, z: 1 };
  const b = { x: 4, y: 0, z: 5 };

  it('ignores a repeated waypoint (double-click) and caps the path length', () => {
    expect(appendWaypoint([a], a)).toEqual([a]);
    expect(appendWaypoint([a], b)).toEqual([a, b]);
    const full = Array.from({ length: MAX_RULER_POINTS }, (_, i) => ({ x: i, y: 0, z: 0 }));
    expect(appendWaypoint(full, { x: 99, y: 0, z: 9 })).toBe(full);
  });

  it('appends the live cursor only when it differs from the last waypoint', () => {
    expect(withCursor([a], b)).toEqual([a, b]);
    expect(withCursor([a], a)).toEqual([a]);
    expect(withCursor([a], null)).toEqual([a]);
  });

  it('distinguishes a short waypoint press from a ruler drag in screen pixels', () => {
    expect(rulerDragStarted({ x: 10, y: 10 }, { x: 12, y: 12 })).toBe(false);
    expect(rulerDragStarted({ x: 10, y: 10 }, { x: 14, y: 10 })).toBe(true);
  });

  it('rate-limits previews but always sends forced ones', () => {
    expect(shouldSendRuler(null, 0, false)).toBe(true);
    expect(shouldSendRuler(1000, 1010, false)).toBe(false);
    expect(shouldSendRuler(1000, 1010, true)).toBe(true);
    expect(shouldSendRuler(1000, 1100, false)).toBe(true);
  });

  it('expires remote rulers by phase', () => {
    const base = { sceneId: 's', points: [a], at: 0 };
    expect(rulerExpired({ ...base, phase: 'active' }, 1000)).toBe(false);
    expect(rulerExpired({ ...base, phase: 'active' }, 4000)).toBe(true);
    expect(rulerExpired({ ...base, phase: 'finished' }, 4000)).toBe(false);
    expect(rulerExpired({ ...base, phase: 'cancelled' }, 0)).toBe(true);
  });

  it('names a remote ruler after the sender seat, or DM when seatless', () => {
    const seats = { s1: { label: 'Aria', identityId: 'IDENT' } };
    expect(rulerOwnerName(seats, 'IDENT')).toBe('Aria');
    expect(rulerOwnerName(seats, 'OTHER')).toBe('DM');
  });
});
