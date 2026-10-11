import { z } from 'zod';

// ACT-02. Pure parser and evaluator for standard dice notation (`2d20kh1+5`).
// Randomness is injected, never generated here: `@mythic/shared` is pure
// (TECHNICAL.md — "A shared library: no DOM, no node APIs, no randomness"),
// so callers supply an `Rng` and this module only consumes it.
//
// Grammar (tokens are split on `d`; `k`-keeps attach to the preceding term):
//   expression  := term* integer?
//   term        := sign? count? 'd' sides keep?
//   sign        := '+' | '-'            (required on every term but the first)
//   count       := digits                (leading zeros rejected; empty = 1)
//   sides       := digits                (MIN_SIDES..MAX_SIDES; 0 / leading 0 rejected)
//   keep        := ('kh' | 'kl') digits  (1..count)
//   integer     := sign digits           (whole-expression modifier; ±MAX_MODIFIER)
//
// Semantics: each die draws once per face and, while it lands on the maximum
// side, rerolls and adds the new face (exploding). A die's value is its face
// chain sum. With a keep, the kept die values (exploded sums) are sorted and
// only the highest (kh) or lowest (kl) survive; otherwise every die counts.
// Signed terms and the modifier are summed into the total. `values` records
// every drawn face (exploded chains included, per die, in roll order).

/** Injected randomness: one integer draw per call, within `[min, max]`. */
export type Rng = (min: number, max: number) => number;

export const MIN_SIDES = 2;
export const MAX_SIDES = 1000;
export const MAX_DICE_PER_TERM = 1000;
/** Hard stop for drawn faces, including explosions. */
export const MAX_TOTAL_ROLLS = 100000;
export const MAX_TERMS = 1000;
export const MAX_MODIFIER = 1_000_000;
/** Hard stop for expression length, so pathological input is rejected early. */
export const MAX_EXPRESSION_LENGTH = 10_000;

export class DiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiceError';
  }
}

export type KeepMode = 'highest' | 'lowest';

export interface KeepSpec {
  readonly mode: KeepMode;
  readonly count: number;
}

export interface ParsedTerm {
  readonly sign: 1 | -1;
  readonly count: number;
  readonly sides: number;
  readonly keep?: KeepSpec;
}

export interface ParsedRoll {
  /** The normalized expression that was parsed (trimmed, whitespace-free). */
  readonly expression: string;
  readonly terms: ParsedTerm[];
  /** The whole-expression modifier (a bare trailing integer). */
  readonly modifier: number;
  /** Dice that must be drawn before any explosions. */
  readonly baseRolls: number;
}

export interface RollResult {
  /** Every drawn face (exploded chains per die, in roll order). */
  readonly values: number[];
  readonly total: number;
}

const KeepSpecSchema = z.object({
  mode: z.enum(['highest', 'lowest']),
  count: z.number().int().min(1),
});

export const ParsedTermSchema = z
  .object({
    sign: z.union([z.literal(1), z.literal(-1)]),
    count: z.number().int().min(1),
    sides: z.number().int().min(1),
    keep: KeepSpecSchema.optional(),
  })
  .strict();

export const ParsedRollSchema = z
  .object({
    expression: z.string(),
    terms: z.array(ParsedTermSchema),
    modifier: z.number().int(),
    baseRolls: z.number().int().min(0),
  })
  .strict();

export const RollResultSchema = z
  .object({
    values: z.array(z.number().int()),
    total: z.number().int(),
  })
  .strict();

// A term after an optional sign and count: `d` + sides + optional keep. The
// lookahead `(?![\d.])` stops `d` from matching mid-number (`2.5` after the
// term) or `2d20.d6`-style debris from reading on.
const TERM_RE = /^([+-]?)((\d+)?)d(\d+)([kK][hHlL][1-9]\d*)?(?![\d.])/i;
const INTEGER_RE = /^([+-]?)(\d+)$/;

/**
 * Parse a dice expression. Throws {@link DiceError} on malformed input or
 * absurd sizes (bounds are the exported `MAX_*` constants). Pure: no
 * randomness, no side effects.
 */
export function parseDice(expression: string): ParsedRoll {
  if (typeof expression !== 'string') {
    throw new DiceError('expression must be a string');
  }
  // Trim and drop internal whitespace: `2d6 + 3d4` is a single expression.
  const source = expression.trim().replace(/\s+/g, '');
  if (source.length === 0) {
    throw new DiceError('empty dice expression');
  }
  if (source.length > MAX_EXPRESSION_LENGTH) {
    throw new DiceError(`dice expression exceeds ${String(MAX_EXPRESSION_LENGTH)} characters`);
  }

  const terms: ParsedTerm[] = [];
  let i = 0;
  let modifier = 0;

  while (i < source.length) {
    const m = TERM_RE.exec(source.slice(i));
    if (!m) {
      // Only a bare integer may close the expression, and only once.
      const rest = source.slice(i);
      if (rest === '') break;
      const im = INTEGER_RE.exec(rest);
      if (im) {
        const modifierText = im[2] ?? '';
        if (modifierText[0] === '0' && modifierText.length > 1) {
          throw new DiceError(`leading zeros in modifier: ${expression}`);
        }
        const value = parseInt(modifierText, 10);
        if (value === 0) {
          // A zero modifier is noise: `2d6+0` and bare `0` roll nothing.
          throw new DiceError(`zero modifier: ${expression}`);
        }
        if (Number.isSafeInteger(value) && Math.abs(value) <= MAX_MODIFIER) {
          modifier = (im[1] === '-' ? -1 : 1) * value;
          break;
        }
      }
      throw new DiceError(`invalid dice expression: ${expression}`);
    }

    const signText = m[1] ?? '';
    if (i > 0 && signText === '') {
      throw new DiceError(`missing operator between terms: ${expression}`);
    }
    const countText = m[3] ?? '1';
    const sidesText = m[4] ?? '';
    const keepText = m[5];

    const sign: 1 | -1 = signText === '-' ? -1 : 1;
    if (countText[0] === '0' && countText.length > 1) {
      throw new DiceError(`leading zeros in die count: ${expression}`);
    }
    if (sidesText[0] === '0') {
      throw new DiceError(`dice need at least one side: ${expression}`);
    }
    const count = parseInt(countText, 10);
    const sides = parseInt(sidesText, 10);
    if (count < 1 || count > MAX_DICE_PER_TERM) {
      throw new DiceError(`die count must be 1..${String(MAX_DICE_PER_TERM)}: ${expression}`);
    }
    if (sides < MIN_SIDES) {
      throw new DiceError(`dice need at least ${String(MIN_SIDES)} sides: ${expression}`);
    }
    if (sides > MAX_SIDES) {
      throw new DiceError(`dice sides exceed ${String(MAX_SIDES)}: ${expression}`);
    }

    let keep: KeepSpec | undefined;
    if (keepText) {
      const mode: KeepMode = (keepText[1] ?? '').toLowerCase() === 'h' ? 'highest' : 'lowest';
      const keepCount = parseInt(keepText.slice(2), 10);
      if (!Number.isSafeInteger(keepCount) || keepCount > count) {
        throw new DiceError(`keep count exceeds die count: ${expression}`);
      }
      keep = { mode, count: keepCount };
    }

    if (keep) {
      terms.push({ sign, count, sides, keep });
    } else {
      terms.push({ sign, count, sides });
    }
    if (terms.length > MAX_TERMS) {
      throw new DiceError(`too many terms (max ${String(MAX_TERMS)}): ${expression}`);
    }
    i += m[0].length;
  }

  if (terms.length === 0 && modifier === 0) {
    // A roll that rolls nothing and adds nothing is noise, not a roll.
    throw new DiceError(`roll must do something: ${expression}`);
  }

  const baseRolls = terms.reduce((sum, term) => sum + term.count, 0);
  if (baseRolls > MAX_TOTAL_ROLLS) {
    throw new DiceError(`base rolls exceed ${String(MAX_TOTAL_ROLLS)}: ${expression}`);
  }
  return { expression: source, terms, modifier, baseRolls };
}

/**
 * Evaluate a parsed roll against an injected rng. Pure with respect to its
 * inputs: the same parsed roll and the same rng stream always produce the
 * same {@link RollResult}.
 */
export function evaluateDice(parsed: ParsedRoll, rng: Rng): RollResult {
  let total = parsed.modifier;
  const values: number[] = [];

  for (const term of parsed.terms) {
    const dieValues: number[] = [];
    for (let n = 0; n < term.count; n++) {
      if (values.length >= MAX_TOTAL_ROLLS) {
        break;
      }
      let last = rng(1, term.sides);
      values.push(last);
      let face = last;
      while (last === term.sides) {
        // Maxed: reroll and keep the chain sum (exploding).
        last = rng(1, term.sides);
        values.push(last);
        face += last;
        if (values.length >= MAX_TOTAL_ROLLS) break;
      }
      dieValues.push(face);
    }

    let kept: number[];
    if (term.keep) {
      const sorted = [...dieValues].sort((a, b) => a - b);
      kept =
        term.keep.mode === 'highest'
          ? sorted.slice(-term.keep.count)
          : sorted.slice(0, term.keep.count);
    } else {
      kept = dieValues;
    }
    const sum = kept.reduce((acc, value) => acc + value, 0);
    total += term.sign === 1 ? sum : -sum;
  }

  return { values, total };
}

/** Convenience: parse and evaluate in one call. */
export function rollDice(expression: string, rng: Rng): RollResult {
  return evaluateDice(parseDice(expression), rng);
}
