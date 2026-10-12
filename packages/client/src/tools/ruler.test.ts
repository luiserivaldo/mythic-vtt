import { describe, expect, it } from 'vitest';
import type { Grid, Scene } from '@mythic/shared';
import {
  appendWaypoint,
  finiteRulerPoint,
  formatRulerDistance,
  measureRuler,
  MAX_RULER_POINTS,
  prepareRulerPoint,
  rulerDragStarted,
  rulerExpired,
  rulerOwnerName,
  rulerRightClick,
  shouldSendRuler,
  withCursor,
  type RulerRightClickContext,
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

describe('ruler right-click branching (M1-45, MEAS-08/Q31)', () => {
  const armed: RulerRightClickContext = {
    tool: true,
    aoeActive: false,
    mode: '2d',
    measuring: true,
  };

  it('turns a right click into a waypoint only while a 2D ruler is measuring', () => {
    expect(rulerRightClick(armed)).toBe('waypoint');
    expect(rulerRightClick({ ...armed, mode: '3d' })).toBe('clear');
    expect(rulerRightClick({ ...armed, measuring: false })).toBe('clear');
    expect(rulerRightClick({ ...armed, mode: '3d', measuring: false })).toBe('clear');
  });

  it('leaves the right click alone for an AoE draft or a disarmed ruler (M1-41)', () => {
    expect(rulerRightClick({ ...armed, aoeActive: true })).toBe('ignore');
    expect(rulerRightClick({ ...armed, aoeActive: true, mode: '3d', measuring: false })).toBe(
      'ignore',
    );
    expect(rulerRightClick({ ...armed, tool: false })).toBe('ignore');
    expect(rulerRightClick({ ...armed, tool: false, measuring: false })).toBe('ignore');
    expect(rulerRightClick({ ...armed, tool: false, aoeActive: true })).toBe('ignore');
  });

  it('sums waypoint legs cumulatively in scene units instead of measuring from the start', () => {
    // Two right clicks on cell centres: 6 cells east, then 6 cells south of that waypoint.
    const start = { x: 0.5, y: 0, z: 0.5 };
    const corner = { x: 6.5, y: 0, z: 0.5 };
    const cursor = { x: 6.5, y: 0, z: 6.5 };
    const path = withCursor(withCursor(appendWaypoint([start], corner), cursor), cursor);
    const measured = measureRuler(path, grid);
    expect(measured.segments.map((segment) => segment.cells)).toEqual([6, 6]);
    expect(measured.segments.map((segment) => segment.label)).toEqual(['30 ft', '30 ft']);
    expect(measured.totalCells).toBe(12);
    expect(measured.totalLabel).toBe('60 ft');
    // The straight start→cursor line is shorter, so the total really follows the waypoint path.
    expect(measureRuler([start, cursor], grid).totalLabel).toBe('45 ft');
  });

  it('applies the scene diagonal rule and unit scale to every leg of the path', () => {
    const path = [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 5 },
      { x: 5, y: 0, z: 4 },
    ];
    expect(measureRuler(path, grid).segments.map((segment) => segment.cells)).toEqual([6, 3]);
    expect(measureRuler(path, { ...grid, diagonal: 'chebyshev' }).totalLabel).toBe('40 ft');
    expect(measureRuler(path, { ...grid, diagonal: 'manhattan' }).totalLabel).toBe('55 ft');
    expect(measureRuler(path, { ...grid, unitsPerCell: 1, unitLabel: 'm' }).totalLabel).toBe('9 m');
  });

  it('refuses a non-finite waypoint or cursor instead of poisoning the total', () => {
    const points = [{ x: 1, y: 0, z: 1 }];
    expect(finiteRulerPoint({ x: 0, y: 0, z: 0 })).toBe(true);
    expect(finiteRulerPoint({ x: -2, y: 0, z: -3 })).toBe(true);
    expect(finiteRulerPoint({ x: Number.NaN, y: 0, z: 1 })).toBe(false);
    expect(finiteRulerPoint({ x: 1, y: Number.POSITIVE_INFINITY, z: 1 })).toBe(false);
    expect(finiteRulerPoint({ x: 1, y: 0, z: Number.NEGATIVE_INFINITY })).toBe(false);

    expect(appendWaypoint(points, { x: Number.NaN, y: 0, z: 1 })).toBe(points);
    expect(appendWaypoint(points, { x: 1, y: 0, z: Number.POSITIVE_INFINITY })).toBe(points);
    expect(withCursor(points, { x: Number.NEGATIVE_INFINITY, y: 0, z: 1 })).toBe(points);
    expect(withCursor(points, { x: Number.NaN, y: 0, z: Number.NaN })).toBe(points);

    const measured = measureRuler(appendWaypoint(points, { x: Number.NaN, y: 0, z: 1 }), grid);
    expect(measured.segments).toEqual([]);
    expect(measured.totalLabel).toBe('0 ft');
  });

  it('treats zero-length, negative and grid-aligned waypoints as valid but length-less legs', () => {
    const start = { x: 2, y: 0, z: 2 };
    // A right click that lands on the previous waypoint adds no second point and no length.
    expect(appendWaypoint([start], { ...start })).toEqual([start]);
    expect(withCursor([start], { ...start })).toEqual([start]);

    const measured = measureRuler(
      [
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 2, y: 0, z: -3 },
        { x: 2, y: 0, z: -3 },
      ],
      grid,
    );
    expect(measured.segments.map((segment) => segment.cells)).toEqual([2, 3, 0]);
    expect(measured.totalLabel).toBe('25 ft');
  });
});
