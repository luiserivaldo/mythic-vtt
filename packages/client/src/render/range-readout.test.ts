import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Entity, Scene, toSceneUnits, type Grid, type Vec3 } from '@mythic/shared';
import { tid } from '../testing.js';
import {
  formatRangeBreakdown,
  measureRange,
  rangeTarget,
  selectedTokenId,
} from './range-readout.js';

const ORIGIN = tid(1);
const TARGET = tid(2);
const PROP = tid(3);

const grid = (patch: Partial<Grid> = {}): Grid => ({
  type: 'square',
  sizePx: 70,
  unitsPerCell: 5,
  unitLabel: 'ft',
  diagonal: 'alternating',
  snap: true,
  ...patch,
});

const token = (id: string, position: Vec3) =>
  Entity.parse({
    id,
    layer: 'tokens',
    name: `Token ${id.slice(0, 1)}`,
    owners: [],
    transform: {
      position,
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    },
    token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
  });

const prop = (id: string, position: Vec3) =>
  Entity.parse({
    id,
    layer: 'props',
    name: 'Wall',
    owners: [],
    transform: {
      position,
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    },
    shape: { kind: 'box', color: '#334455', walkable: false },
  });

function scene(entities: Record<string, Entity>, gridPatch: Partial<Grid> = {}): Scene {
  return Scene.parse({
    id: tid(9),
    name: 'Range scene',
    grid: grid(gridPatch),
    environment: { background: '#102030' },
    layers: {},
    entities,
  });
}

const at = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

describe('measureRange (MEAS-05 / MEAS-01)', () => {
  it('reports horizontal, vertical and total in the scene units', () => {
    const measured = measureRange(at(0, 0, 0), at(6, 0, 0), grid());
    expect(measured).toMatchObject({ cells: 6, horizontalCells: 6, verticalCells: 0 });
    expect(
      formatRangeBreakdown(measured.horizontalLabel, measured.verticalLabel, measured.label),
    ).toBe('H 30 ft · V 0 ft · T 30 ft');
  });

  it('keeps elevation out of the horizontal leg and inside the total', () => {
    const measured = measureRange(at(0, 0, 0), at(6, 2, 3), grid());
    expect(measured.horizontalCells).toBe(7);
    expect(measured.verticalCells).toBe(2);
    expect(measured.cells).toBe(8);
    expect([measured.horizontalLabel, measured.verticalLabel, measured.label]).toEqual([
      '35 ft',
      '10 ft',
      '40 ft',
    ]);
  });

  it('applies the scene diagonal rule', () => {
    const from = at(0, 0, 0);
    const to = at(1, 0, 1);
    expect(measureRange(from, to, grid({ diagonal: 'chebyshev' })).cells).toBe(1);
    expect(measureRange(from, to, grid({ diagonal: 'manhattan' })).cells).toBe(2);
    expect(measureRange(from, to, grid({ diagonal: 'alternating' })).cells).toBe(1);
    const euclidean = measureRange(from, to, grid({ diagonal: 'euclidean' }));
    expect(euclidean.cells).toBeCloseTo(Math.SQRT2, 10);
    expect(euclidean.label).toBe('7.07 ft');
  });

  it('rounds a fractional distance to two decimals and keeps integers bare', () => {
    expect(measureRange(at(0, 0, 0), at(1, 0, 2), grid({ diagonal: 'euclidean' })).label).toBe(
      '11.18 ft',
    );
    expect(measureRange(at(0, 0, 0), at(0, 3, 4), grid({ diagonal: 'euclidean' })).label).toBe(
      '25 ft',
    );
  });

  it('measures across the origin in any direction', () => {
    const mirrored = measureRange(at(-3, -2, -1), at(0, 0, 0), grid());
    expect(mirrored).toEqual(measureRange(at(3, 2, 1), at(0, 0, 0), grid()));
    expect(mirrored.verticalLabel).toBe('10 ft');
  });

  it('uses sub-unit and unlabelled grids', () => {
    const metres = measureRange(
      at(0, 0, 0),
      at(3, 1, 0),
      grid({ unitsPerCell: 0.5, unitLabel: 'm' }),
    );
    expect([metres.horizontalLabel, metres.verticalLabel, metres.label]).toEqual([
      '1.5 m',
      '0.5 m',
      '1.5 m',
    ]);
    expect(measureRange(at(0, 0, 0), at(6, 0, 0), grid({ unitLabel: '  ' })).label).toBe('30');
    expect(measureRange(at(0, 0, 0), at(6, 0, 0), grid({ unitLabel: ' ft ' })).label).toBe('30 ft');
  });

  it('measures a fractional cell distance without losing the sub-cell part', () => {
    const measured = measureRange(at(0, 0, 0), at(2.5, 0, 0), grid());
    expect(measured.cells).toBe(2.5);
    expect(measured.label).toBe('12.5 ft');
  });

  it('never prints a negative zero for a token pair that only differs downwards', () => {
    expect(measureRange(at(0, 0, 0), at(0, 0, 0), grid()).label).toBe('0 ft');
    expect(measureRange(at(0, 0, 0), at(0, -3, 0), grid()).verticalLabel).toBe('15 ft');
  });

  it('agrees with the shared conversion for random finite tokens (property)', () => {
    const finite = fc.double({ min: -200, max: 200, noNaN: true, noDefaultInfinity: true });
    fc.assert(
      fc.property(finite, finite, finite, finite, finite, finite, (ax, ay, az, bx, by, bz) => {
        const rule = grid();
        const measured = measureRange(at(ax, ay, az), at(bx, by, bz), rule);
        expect(measured.verticalCells).toBeCloseTo(Math.abs(ay - by), 10);
        expect(measured.cells).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(measured.cells)).toBe(true);
        // Symmetry: a readout does not depend on which token is selected.
        expect(measureRange(at(bx, by, bz), at(ax, ay, az), rule).label).toBe(measured.label);
      }),
    );
  });

  it('keeps integer-only results integers (property)', () => {
    // Euclidean results are irrational; the three integer rules must never grow a decimal part.
    const cells = fc.integer({ min: -40, max: 40 });
    const units = fc.integer({ min: 1, max: 20 });
    fc.assert(
      fc.property(
        cells,
        cells,
        cells,
        cells,
        cells,
        cells,
        units,
        fc.constantFrom<Grid['diagonal']>('chebyshev', 'manhattan', 'alternating'),
        (ax, ay, az, bx, by, bz, unitsPerCell, diagonal) => {
          const measured = measureRange(
            at(ax, ay, az),
            at(bx, by, bz),
            grid({ unitsPerCell, diagonal }),
          );
          expect(measured.label).not.toContain('.');
          expect(measured.label.endsWith(' ft')).toBe(true);
          expect(Number(measured.label.slice(0, -3))).toBe(
            toSceneUnits(measured.cells, { unitsPerCell }),
          );
        },
      ),
    );
  });
});

describe('selectedTokenId (MEAS-05)', () => {
  const board = scene({
    [ORIGIN]: token(ORIGIN, at(0, 0, 0)),
    [TARGET]: token(TARGET, at(6, 0, 0)),
    [PROP]: prop(PROP, at(1, 0, 1)),
  });

  it('needs exactly one selected token', () => {
    expect(selectedTokenId(board, [])).toBeNull();
    expect(selectedTokenId(board, [ORIGIN])).toBe(ORIGIN);
    expect(selectedTokenId(board, [TARGET])).toBe(TARGET);
    expect(selectedTokenId(board, [PROP])).toBeNull();
    expect(selectedTokenId(board, [tid(31)])).toBeNull();
    expect(selectedTokenId(board, [PROP, ORIGIN])).toBe(ORIGIN);
    expect(selectedTokenId(board, [ORIGIN, TARGET])).toBeNull();
    expect(selectedTokenId(board, [ORIGIN, ORIGIN])).toBeNull();
    expect(selectedTokenId(null, [ORIGIN])).toBeNull();
  });
});

describe('rangeTarget (MEAS-05)', () => {
  const board = scene({
    [ORIGIN]: token(ORIGIN, at(0, 0, 0)),
    [TARGET]: token(TARGET, at(6, 0, 0)),
    [PROP]: prop(PROP, at(3, 0, 0)),
  });

  it('measures from the selected token to the hovered one', () => {
    const found = rangeTarget(board, [ORIGIN], TARGET);
    expect(found).not.toBeNull();
    expect(found?.originId).toBe(ORIGIN);
    expect(found?.targetId).toBe(TARGET);
    expect(found?.origin).toEqual(at(0, 0, 0));
    expect(found?.target).toEqual(at(6, 0, 0));
    expect(found?.measurement.label).toBe('30 ft');
  });

  it('shows nothing without a hover, without an origin, or for the origin itself', () => {
    expect(rangeTarget(board, [ORIGIN], null)).toBeNull();
    expect(rangeTarget(board, [], TARGET)).toBeNull();
    expect(rangeTarget(board, [ORIGIN], ORIGIN)).toBeNull();
    expect(rangeTarget(board, [ORIGIN, TARGET], TARGET)).toBeNull();
    expect(rangeTarget(null, [ORIGIN], TARGET)).toBeNull();
  });

  it('shows nothing for an entity without a token or an unknown id', () => {
    expect(rangeTarget(board, [ORIGIN], PROP)).toBeNull();
    expect(rangeTarget(board, [ORIGIN], tid(31))).toBeNull();
    expect(rangeTarget(board, [PROP], TARGET)).toBeNull();
  });

  it('refuses a non-finite token position instead of printing Infinity', () => {
    // The schema rejects non-finite numbers, so this only happens if a corrupt transform reaches a
    // client some other way; the readout must then show nothing rather than "Infinity ft".
    const valid = scene({
      [ORIGIN]: token(ORIGIN, at(0, 0, 0)),
      [TARGET]: token(TARGET, at(1, 0, 0)),
      [PROP]: token(PROP, at(1, 0, 1)),
    });
    const corrupt = (id: string, position: Vec3): Entity => {
      const entity = valid.entities[id];
      if (!entity) throw new Error(`missing fixture entity ${id}`);
      return { ...entity, transform: { ...entity.transform, position } };
    };
    const broken: Scene = {
      ...valid,
      entities: {
        ...valid.entities,
        [TARGET]: corrupt(TARGET, at(Number.POSITIVE_INFINITY, 0, 0)),
        [PROP]: corrupt(PROP, at(1, Number.NaN, 1)),
      },
    };
    expect(rangeTarget(broken, [ORIGIN], TARGET)).toBeNull();
    expect(rangeTarget(broken, [ORIGIN], PROP)).toBeNull();
    expect(rangeTarget(broken, [TARGET], ORIGIN)).toBeNull();
    expect(selectedTokenId(broken, [PROP])).toBeNull();
  });

  it('reads the hovered token position as its feet, including elevation', () => {
    const elevated = scene({
      [ORIGIN]: token(ORIGIN, at(2, 0, 2)),
      [TARGET]: token(TARGET, at(2, 4, 2)),
    });
    const found = rangeTarget(elevated, [ORIGIN], TARGET);
    expect(found?.measurement.horizontalCells).toBe(0);
    expect(found?.measurement.verticalCells).toBe(4);
    expect(found?.measurement.verticalLabel).toBe('20 ft');
  });
});
