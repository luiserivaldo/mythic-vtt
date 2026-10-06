import { describe, expect, it } from 'vitest';
import { footprintCells, SIZE_CELLS } from './token-footprint.js';

describe('footprintCells (TOK-09)', () => {
  it('passes valid sizes through, including tiny and gargantuan', () => {
    expect(footprintCells(SIZE_CELLS.tiny)).toBe(0.5);
    expect(footprintCells(SIZE_CELLS.gargantuan)).toBe(4);
  });
  it('falls back to one cell for bad values', () => {
    for (const bad of [undefined, 0, -2, Number.NaN, Infinity]) expect(footprintCells(bad)).toBe(1);
  });
});
