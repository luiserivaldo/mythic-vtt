import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DiceError,
  evaluateDice,
  MAX_DICE_PER_TERM,
  MAX_EXPRESSION_LENGTH,
  MAX_MODIFIER,
  MAX_SIDES,
  MAX_TERMS,
  MAX_TOTAL_ROLLS,
  MIN_SIDES,
  ParsedRollSchema,
  parseDice,
  RollResultSchema,
  rollDice,
  type ParsedRoll,
  type Rng,
} from './notation.js';

/** Deterministic rng: a fixed cycle over `min..min+period-1`. */
function cyclingRng(period: number): Rng {
  let n = 0;
  return (min) => {
    n += 1;
    return min + ((n - 1) % period);
  };
}

/** rng that plays fixed faces in order, clamped to the drawn range. */
function facesRng(faces: number[]): Rng {
  let n = 0;
  return (min, max) => {
    const face = n < faces.length ? (faces[n] ?? max) : max;
    n += 1;
    return Math.min(Math.max(face, min), max);
  };
}

describe('parseDice', () => {
  it('parses the canonical example from ACT-02', () => {
    expect(parseDice('2d20kh1+5')).toEqual({
      expression: '2d20kh1+5',
      terms: [{ sign: 1, count: 2, sides: 20, keep: { mode: 'highest', count: 1 } }],
      modifier: 5,
      baseRolls: 2,
    });
  });

  it('parses several signed terms with keeps', () => {
    const parsed = parseDice('-2d6kl2 + 3d4kh2 - 1d8');
    expect(parsed.terms).toEqual([
      { sign: -1, count: 2, sides: 6, keep: { mode: 'lowest', count: 2 } },
      { sign: 1, count: 3, sides: 4, keep: { mode: 'highest', count: 2 } },
      { sign: -1, count: 1, sides: 8 },
    ]);
    expect(parsed.modifier).toBe(0);
    expect(parsed.baseRolls).toBe(6);
  });

  it('treats a trailing signed integer as the whole-expression modifier', () => {
    expect(parseDice('2d6+1 4')).toEqual(
      expect.objectContaining({ terms: [{ sign: 1, count: 2, sides: 6 }], modifier: 14 }),
    );
    expect(parseDice('2d6-3').modifier).toBe(-3);
  });

  it('parses a bare integer as a modifier-only roll', () => {
    expect(parseDice('+7')).toEqual({ expression: '+7', terms: [], modifier: 7, baseRolls: 0 });
    expect(parseDice('42').modifier).toBe(42);
    expect(parseDice('-3').modifier).toBe(-3);
  });

  it('parses the bare d20 shorthand as 1d20', () => {
    expect(parseDice('d20').terms).toEqual([{ sign: 1, count: 1, sides: 20 }]);
  });

  it('is case-insensitive and strips whitespace', () => {
    const parsed = parseDice('  2D20KH1  ');
    expect(parsed.terms).toEqual([
      { sign: 1, count: 2, sides: 20, keep: { mode: 'highest', count: 1 } },
    ]);
    expect(parseDice('2d6 + 3d4').expression).toBe('2d6+3d4');
    expect(parseDice(' 2d6+3d4 ').expression).toBe('2d6+3d4');
  });

  it('rejects malformed input with DiceError', () => {
    const malformed = [
      '',
      '   ',
      'd',
      '2d',
      'd20d6',
      '2d20+',
      '2d20 3d6',
      '2d20k',
      '2d20kh0',
      '2d20kh3',
      '2d20kl3',
      '2d01',
      '01d6',
      '0d6',
      '1.5d6',
      '2d6.5',
      'd20 d6',
      '2d20x',
      '2d20x5',
      '2d20kh1x',
      '2d20 2d20 2d20 2d20',
      '++2d6',
      '2d6--5',
      '2d6+',
      '2d20+05',
      'd20+1-2',
      '-2d20kh3',
      '2d20kh1+5-3d6-1+2',
      '2d20kh1+5-3d6-1+2d4 1',
      '0',
    ];
    for (const source of malformed) {
      expect(() => parseDice(source), `should reject ${JSON.stringify(source)}`).toThrow(DiceError);
    }
  });

  it('rejects absurd sizes', () => {
    expect(() => parseDice('1001d20')).toThrow(DiceError);
    expect(() => parseDice('2d1')).toThrow(DiceError);
    expect(() => parseDice('2d1001')).toThrow(DiceError);
    expect(() => parseDice(`2d20+${String(MAX_MODIFIER + 1)}`)).toThrow(DiceError);
    expect(() => parseDice(`${'9d6 + '.repeat(MAX_TERMS)}1d6`)).toThrow(DiceError);
    expect(() => parseDice(`${'101d6+'.repeat(MAX_TERMS - 1)}101d6`)).toThrow(DiceError);
    expect(() => parseDice(`2d6+${'2d6+'.repeat(MAX_EXPRESSION_LENGTH / 4 + 1)}`)).toThrow(
      DiceError,
    );
  });

  it('accepts the exact maxima', () => {
    expect(parseDice(`${String(MAX_DICE_PER_TERM)}d${String(MAX_SIDES)}`).baseRolls).toBe(
      MAX_DICE_PER_TERM,
    );
    expect(parseDice(`2d20+${String(MAX_MODIFIER)}`).modifier).toBe(MAX_MODIFIER);
  });
});

describe('evaluateDice', () => {
  it('is a pure function of the rng stream: same stream, same result', () => {
    const parsed = parseDice('2d20kh1+5');
    expect(evaluateDice(parsed, cyclingRng(20))).toEqual(evaluateDice(parsed, cyclingRng(20)));
  });

  it('keeps the highest die and adds the modifier', () => {
    // 2d20kh1+5 with faces 14 then 7: keep 1 highest = 14, plus 5.
    const result = rollDice('2d20kh1+5', facesRng([14, 7]));
    expect(result).toEqual({ values: [14, 7], total: 19 });
  });

  it('keeps the lowest die', () => {
    // Faces stay below the maximum so no die explodes.
    const result = rollDice('2d20kl1', facesRng([19, 3]));
    expect(result).toEqual({ values: [19, 3], total: 3 });
  });

  it('exploding dice reroll on the maximum; the die is the chain sum', () => {
    // 1d4: 4 (explode), 4 (explode), 2 -> die = 4+4+2 = 10.
    const result = rollDice('1d4', facesRng([4, 4, 2]));
    expect(result).toEqual({ values: [4, 4, 2], total: 10 });
  });

  it('a single max face is not an explosion chain by itself', () => {
    const result = rollDice('1d6', facesRng([6, 1]));
    expect(result).toEqual({ values: [6, 1], total: 7 });
  });

  it('keeps compare exploded die values, not the raw draws', () => {
    // 2d4kh1: die A explodes 4+3 = 7, die B is 1; keep best = 7.
    const result = rollDice('2d4kh1', facesRng([4, 3, 1]));
    expect(result).toEqual({ values: [4, 3, 1], total: 7 });
  });

  it('combines signed terms and a whole-expression modifier', () => {
    // -1d4 (3) + 2d4kl1 (4 explodes, rerolls 2 -> die 6; other die 1; keep
    // lowest = 1) + 2 => 2 - 3 + 1.
    const result = rollDice('-1d4+2d4kl1+2', facesRng([3, 4, 2, 1]));
    expect(result).toEqual({ values: [3, 4, 2, 1], total: 0 });
  });

  it('evaluates a modifier-only roll without drawing', () => {
    const rng: Rng = () => {
      throw new Error('rng must not be called for a modifier-only roll');
    };
    expect(rollDice('+7', rng)).toEqual({ values: [], total: 7 });
    expect(rollDice('-3', rng)).toEqual({ values: [], total: -3 });
  });

  it('bounds a degenerate always-max rng at MAX_TOTAL_ROLLS draws', () => {
    const result = rollDice('2d4', (_min, max) => max);
    expect(result.values.length).toBe(MAX_TOTAL_ROLLS);
    expect(result.total).toBe(4 * MAX_TOTAL_ROLLS);
  });
});

describe('property tests', () => {
  const countArb = fc.integer({ min: 1, max: 50 });
  const sidesArb = fc.integer({ min: MIN_SIDES, max: 100 });
  const modArb = fc.integer({ min: -999, max: 999 });
  const periodArb = fc.integer({ min: 1, max: 50 });

  it('parses well-formed expressions with the expected fields', () => {
    fc.assert(
      fc.property(countArb, sidesArb, modArb, (count, sides, mod) => {
        const source = `${String(count)}d${String(sides)}${mod === 0 ? '' : mod > 0 ? `+${String(mod)}` : String(mod)}`;
        const parsed = parseDice(source);
        expect(parsed.terms).toHaveLength(1);
        expect(parsed.terms[0]).toEqual({ sign: 1, count, sides });
        expect(parsed.modifier).toBe(mod);
        expect(parsed.baseRolls).toBe(count);
      }),
    );
  });

  it('keeps the total within combinatorial bounds (no explosions)', () => {
    fc.assert(
      fc.property(countArb, sidesArb, periodArb, (count, sides, period) => {
        const parsed = parseDice(`${String(count)}d${String(sides)}`);
        // period < sides: faces never reach the maximum, so no die explodes.
        const result = evaluateDice(parsed, cyclingRng(Math.min(period, sides - 1)));
        const { min, max } = boundsFor(parsed);
        expect(result.total).toBeGreaterThanOrEqual(min);
        expect(result.total).toBeLessThanOrEqual(max);
        expect(Number.isInteger(result.total)).toBe(true);
      }),
    );
  });

  it('keeps total and every recorded value an integer', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(countArb, sidesArb, fc.boolean()), { minLength: 1, maxLength: 4 }),
        modArb,
        (terms, mod) => {
          const source =
            terms
              .map(([count, sides, negative], idx) =>
                [negative ? '-' : idx === 0 ? '' : '+', `${String(count)}d${String(sides)}`].join(
                  '',
                ),
              )
              .join('') + (mod === 0 ? '' : mod > 0 ? `+${String(mod)}` : String(mod));
          const result = rollDice(source, cyclingRng(97));
          expect(Number.isInteger(result.total)).toBe(true);
          for (const value of result.values) expect(Number.isInteger(value)).toBe(true);
        },
      ),
    );
  });

  it('keeps kept totals within kept-face bounds (no explosions)', () => {
    fc.assert(
      fc.property(countArb, sidesArb, (count, sides) => {
        for (const keep of [1, Math.min(2, count), count]) {
          const parsed = parseDice(`${String(count)}d${String(sides)}kh${String(keep)}`);
          const result = evaluateDice(parsed, cyclingRng(sides - 1));
          expect(result.total).toBeGreaterThanOrEqual(keep);
          expect(result.total).toBeLessThanOrEqual(keep * (sides - 1));
        }
      }),
    );
  });

  it('is deterministic for a given rng stream', () => {
    fc.assert(
      fc.property(countArb, sidesArb, periodArb, (count, sides, period) => {
        const parsed = parseDice(`${String(count)}d${String(sides)}`);
        expect(evaluateDice(parsed, cyclingRng(period))).toEqual(
          evaluateDice(parsed, cyclingRng(period)),
        );
      }),
    );
  });
});

/** Inclusive bounds of a roll's total, assuming no die explodes. */
function boundsFor(parsed: ParsedRoll): { min: number; max: number } {
  let min = parsed.modifier;
  let max = parsed.modifier;
  for (const term of parsed.terms) {
    const kept = term.keep ? term.keep.count : term.count;
    if (term.sign > 0) {
      min += kept;
      max += kept * term.sides;
    } else {
      min -= kept * term.sides;
      max -= kept;
    }
  }
  return { min, max };
}

describe('zod schemas', () => {
  it('validate parsed and roll results', () => {
    expect(RollResultSchema.parse({ values: [1, 2], total: 3 }).total).toBe(3);
    expect(() => RollResultSchema.parse({ values: [1.5], total: 1 })).toThrow();
    expect(() => RollResultSchema.parse({ values: [], total: 1, extra: true })).toThrow();

    const parsed = parseDice('2d20kh1+5');
    expect(ParsedRollSchema.parse(parsed).expression).toBe('2d20kh1+5');
    expect(() =>
      ParsedRollSchema.parse({ ...parsed, terms: [{ sign: 2, count: 1, sides: 6 }] }),
    ).toThrow();
  });
});
