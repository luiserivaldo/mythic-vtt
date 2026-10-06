import { describe, expect, it } from 'vitest';
import {
  TOKEN_SIZE_CELLS,
  TOKEN_SIZE_DIMENSIONS,
  TokenSize,
  tokenDimensionsForSize,
  tokenFootprintCells,
} from './token-size.js';

describe('token size footprints (TOK-09)', () => {
  it('maps Tiny through Gargantuan to cell footprints and default heights', () => {
    expect(TOKEN_SIZE_DIMENSIONS).toEqual({
      tiny: { sizeCells: 0.5, heightCells: 0.5 },
      small: { sizeCells: 1, heightCells: 1 },
      medium: { sizeCells: 1, heightCells: 1 },
      large: { sizeCells: 2, heightCells: 2 },
      huge: { sizeCells: 3, heightCells: 3 },
      gargantuan: { sizeCells: 4, heightCells: 4 },
    });
  });

  it('accepts only the supported named sizes', () => {
    expect(TokenSize.safeParse('tiny').success).toBe(true);
    expect(TokenSize.safeParse('gargantuan').success).toBe(true);
    expect(TokenSize.safeParse('colossal').success).toBe(false);
    expect(TokenSize.safeParse(2).success).toBe(false);
  });

  it('exposes the canonical square footprint edges', () => {
    expect(TOKEN_SIZE_CELLS).toEqual({
      tiny: 0.5,
      small: 1,
      medium: 1,
      large: 2,
      huge: 3,
      gargantuan: 4,
    });
  });

  it('falls back to one cell for malformed stored footprints', () => {
    expect(tokenFootprintCells(0.5)).toBe(0.5);
    expect(tokenFootprintCells(4)).toBe(4);
    for (const bad of [undefined, 0, -2, Number.NaN, Infinity]) {
      expect(tokenFootprintCells(bad)).toBe(1);
    }
  });

  it('returns dimensions that callers can customize without changing the defaults', () => {
    const dimensions = tokenDimensionsForSize('large');
    dimensions.heightCells = 3;
    expect(tokenDimensionsForSize('large')).toEqual({ sizeCells: 2, heightCells: 2 });
  });
});
