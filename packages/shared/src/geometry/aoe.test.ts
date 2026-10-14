import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cellsInAoE, tokensInAoE, type AoE, type AoEToken } from './aoe.js';
import { UnsupportedGridError } from './snap-to-grid.js';

const square = { type: 'square' as const };
const origin = { x: 0, y: 0, z: 0 };
const halfTurn = { x: 0, y: 1, z: 0, w: 0 };
const key = ({ x, y, z }: { x: number; y: number; z: number }): string => [x, y, z].join(',');
const keys = (aoe: AoE, inclusion: 'center' | 'any-overlap' = 'center'): string[] =>
  cellsInAoE(aoe, square, inclusion).map(key);

describe('AoE geometry', () => {
  it('includes exact centre boundaries and touching cell volumes', () => {
    const sphere: AoE = { kind: 'sphere', position: origin, radius: 0.5 };
    expect(keys(sphere)).toEqual([]);
    expect(keys(sphere, 'any-overlap')).toContain('0,0,0');
    const cube: AoE = { kind: 'cube', position: { x: 0.5, y: 0.5, z: 0.5 }, size: 1 };
    expect(keys(cube)).toEqual(['0,0,0']);
    expect(keys(cube, 'any-overlap')).toContain('1,0,0');
  });

  it('handles zero dimensions and negative coordinates', () => {
    const point: AoE = { kind: 'sphere', position: { x: -1, y: 2, z: 0 }, radius: 0 };
    expect(keys(point)).toEqual([]);
    expect(keys(point, 'any-overlap')).toContain('-1,2,0');
    expect(
      keys({ kind: 'cone', position: { x: -1, y: 2, z: 0 }, radius: 3, length: 0 }, 'any-overlap'),
    ).toContain('-1,2,0');
  });

  it('includes touching token boundaries without including separated footprints', () => {
    const shapes: AoE[] = [
      { kind: 'sphere', position: origin, radius: 1 },
      { kind: 'cylinder', position: origin, radius: 1, height: 2 },
      { kind: 'cube', position: origin, size: 2 },
      { kind: 'line', position: { x: 0, y: 0, z: -1 }, width: 2, height: 2, length: 2 },
    ];
    const token = (id: string, x: number): AoEToken => ({
      id,
      position: { x, y: -0.5, z: 0 },
      sizeCells: 1,
      heightCells: 1,
    });
    for (const shape of shapes) {
      expect(
        tokensInAoE(shape, [token('touch', 1.5), token('away', 1.51)], 'any-overlap').map(
          ({ id }) => id,
        ),
      ).toEqual(['touch']);
    }
  });

  it('uses 3D elevation for cells and token footprints', () => {
    const sphere: AoE = { kind: 'sphere', position: { x: 0.5, y: 2.5, z: 0.5 }, radius: 0.6 };
    expect(keys(sphere)).toEqual(['0,2,0']);
    const tokens: AoEToken[] = [
      { id: 'low', position: { x: 0.5, y: 0, z: 0.5 }, sizeCells: 1, heightCells: 1 },
      { id: 'tall', position: { x: 0.5, y: 0, z: 0.5 }, sizeCells: 2, heightCells: 3 },
      { id: 'high', position: { x: 0.5, y: 2.5, z: 0.5 }, sizeCells: 1, heightCells: 1 },
    ];
    expect(tokensInAoE(sphere, tokens).map((token) => token.id)).toEqual(['high']);
    expect(tokensInAoE(sphere, tokens, 'any-overlap').map((token) => token.id)).toEqual([
      'tall',
      'high',
    ]);
  });

  it('rotates asymmetric volumes in 3D', () => {
    const line: AoE = {
      kind: 'line',
      position: { x: 0.5, y: 0.5, z: 0 },
      length: 3,
      width: 1,
      height: 1,
      rotation: halfTurn,
    };
    expect(keys(line)).toContain('0,0,-2');
    expect(keys(line)).not.toContain('0,0,2');
    const cone: AoE = {
      kind: 'cone',
      position: { x: 0.5, y: 0, z: 0.5 },
      radius: 2,
      length: 3,
      rotation: { x: -Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 },
    };
    expect(keys(cone)).toContain('0,2,0');
    expect(keys(cone)).not.toContain('0,-2,0');
  });

  it('covers each shape in both rules', () => {
    const shapes: AoE[] = [
      { kind: 'sphere', position: origin, radius: 2 },
      { kind: 'cylinder', position: origin, radius: 2, height: 2 },
      { kind: 'cone', position: origin, radius: 2, length: 3 },
      { kind: 'cube', position: origin, size: 3 },
      { kind: 'line', position: origin, width: 2, height: 2, length: 3 },
    ];
    for (const shape of shapes) {
      expect(keys(shape).length).toBeGreaterThan(0);
      expect(keys(shape, 'any-overlap').length).toBeGreaterThanOrEqual(keys(shape).length);
    }
  });

  it('rejects unsupported hex cell enumeration', () => {
    expect(() =>
      cellsInAoE({ kind: 'sphere', position: origin, radius: 1 }, { type: 'hex' }),
    ).toThrow(UnsupportedGridError);
  });

  it('keeps centre cells and tokens in the overlap selection', () => {
    const coordinate = fc.integer({ min: -3, max: 3 });
    const shape = fc.record({
      x: coordinate,
      y: coordinate,
      z: coordinate,
      radius: fc.integer({ min: 0, max: 3 }),
    });
    fc.assert(
      fc.property(shape, ({ x, y, z, radius }) => {
        const aoe: AoE = { kind: 'sphere', position: { x, y, z }, radius };
        const overlap = new Set(keys(aoe, 'any-overlap'));
        for (const cell of keys(aoe)) expect(overlap.has(cell)).toBe(true);
        const tokens: AoEToken[] = [
          { id: 'one', position: { x: x + 0.5, y, z: z + 0.5 }, sizeCells: 2, heightCells: 2 },
        ];
        if (tokensInAoE(aoe, tokens).length)
          expect(tokensInAoE(aoe, tokens, 'any-overlap')).toEqual(tokens);
      }),
      { numRuns: 50 },
    );
  });

  it('keeps centre cells within overlap for every volume', () => {
    const coordinate = fc.integer({ min: -2, max: 2 });
    fc.assert(
      fc.property(
        coordinate,
        coordinate,
        fc.integer({ min: 0, max: 3 }),
        fc.boolean(),
        (x, y, size, rotated) => {
          const position = { x: x + 0.5, y: y + 0.5, z: 0.5 };
          const orientation = rotated
            ? { rotation: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 } }
            : {};
          const shapes: AoE[] = [
            { kind: 'cylinder', position, radius: size, height: size, ...orientation },
            { kind: 'cone', position, radius: size, length: size, ...orientation },
            { kind: 'cube', position, size, ...orientation },
            { kind: 'line', position, width: size, height: size, length: size, ...orientation },
          ];
          for (const shape of shapes) {
            const overlap = new Set(keys(shape, 'any-overlap'));
            for (const cell of keys(shape)) expect(overlap.has(cell)).toBe(true);
          }
        },
      ),
      { numRuns: 30 },
    );
  });

  it('rotates selected line cells by a quarter turn around Y', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), (length) => {
        const base: AoE = {
          kind: 'line',
          position: { x: 0.5, y: 0.5, z: 0.5 },
          length,
          width: 1,
          height: 1,
        };
        const turned: AoE = { ...base, rotation: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 } };
        const expected = keys(base).map((cell) => {
          const [x = 0, y = 0, z = 0] = cell.split(',').map(Number);
          return [z, y, -x].join(',');
        });
        expect(new Set(keys(turned))).toEqual(new Set(expected));
      }),
    );
  });

  it('places zero-sized points only in overlapping cells at every elevation', () => {
    fc.assert(
      fc.property(fc.integer({ min: -5, max: 5 }), (y) => {
        const point: AoE = { kind: 'sphere', position: { x: 0.5, y: y + 0.5, z: 0.5 }, radius: 0 };
        expect(keys(point)).toEqual(['0,' + String(y) + ',0']);
        expect(keys(point, 'any-overlap')).toEqual(['0,' + String(y) + ',0']);
      }),
    );
  });

  it('is translation invariant and symmetric around a sphere', () => {
    fc.assert(
      fc.property(fc.integer({ min: -3, max: 3 }), fc.integer({ min: -3, max: 3 }), (dx, dy) => {
        const base: AoE = { kind: 'sphere', position: { x: 0.5, y: 0.5, z: 0.5 }, radius: 1.5 };
        const moved: AoE = { ...base, position: { x: dx + 0.5, y: dy + 0.5, z: 0.5 } };
        const baseCells = keys(base).map((cell) => cell.split(',').map(Number));
        expect(keys(moved)).toEqual(
          baseCells.map(([x = 0, y = 0, z = 0]) => [x + dx, y + dy, z].join(',')),
        );
        const selected = new Set(keys(base));
        for (const [x = 0, y = 0, z = 0] of baseCells)
          expect(selected.has([-x, -y, -z].join(','))).toBe(true);
      }),
      { numRuns: 30 },
    );
  });
});
