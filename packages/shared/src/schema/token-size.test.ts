import { describe, expect, it } from 'vitest';
import { TOKEN_SIZE_DIMENSIONS, TokenSize, tokenDimensionsForSize } from './token-size.js';

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

  it('returns dimensions that callers can customize without changing the defaults', () => {
    const dimensions = tokenDimensionsForSize('large');
    dimensions.heightCells = 3;
    expect(tokenDimensionsForSize('large')).toEqual({ sizeCells: 2, heightCells: 2 });
  });
});
