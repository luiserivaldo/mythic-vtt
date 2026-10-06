import { z } from 'zod';

/** TOK-09 named creature sizes, stored on tokens as numeric cell dimensions. */
export const TokenSize = z.enum(['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan']);
export type TokenSize = z.infer<typeof TokenSize>;

export interface TokenDimensions {
  sizeCells: number;
  heightCells: number;
}

/**
 * TOK-09 defaults. Small and Medium both occupy one cell; height remains independently
 * configurable on the token component after creation.
 */
export const TOKEN_SIZE_DIMENSIONS = {
  tiny: { sizeCells: 0.5, heightCells: 0.5 },
  small: { sizeCells: 1, heightCells: 1 },
  medium: { sizeCells: 1, heightCells: 1 },
  large: { sizeCells: 2, heightCells: 2 },
  huge: { sizeCells: 3, heightCells: 3 },
  gargantuan: { sizeCells: 4, heightCells: 4 },
} as const satisfies Readonly<Record<TokenSize, TokenDimensions>>;

export function tokenDimensionsForSize(size: TokenSize): TokenDimensions {
  return { ...TOKEN_SIZE_DIMENSIONS[size] };
}
