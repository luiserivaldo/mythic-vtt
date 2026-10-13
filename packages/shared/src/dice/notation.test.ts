import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DiceError,
  evaluateDice,
  MAX_DICE_PER_TERM,
  MAX_EXPRESSION_LENGTH,
  MAX_MODIFIER,
  MAX_MODIFIER_DIGITS,
  MAX_SIDES,
  MAX_TERMS,
  MAX_TOTAL_ROLLS,
  MIN_SIDES,
  ParsedRollSchema,
  parseDice,
  RollResultSchema,
  rollDice,
  type Rng,
} from './notation.js';

/** Deterministic rng cycling through every face of the drawn range, max included. */
function cyclingRng(): Rng {
  let n = 0;
  return (min, max) => {
    const face = min + (n % (max - min + 1));
    n += 1;
    return face;
  };
}

/** cyclingRng that never draws the maximum, so no die explodes. */
function cappedRng(): Rng {
  let n = 0;
  return (min, max) => {
    const face = min + (n % Math.max(1, max - min));
    n += 1;
    return face;
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
    expect(parseDice('2d6+14')).toEqual(
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

  it('is case-insensitive', () => {
    const expected = [{ sign: 1, count: 2, sides: 20, keep: { mode: 'highest', count: 1 } }];
    expect(parseDice('2D20KH1').terms).toEqual(expected);
    expect(parseDice('2d20kh1').terms).toEqual(expected);
    expect(parseDice('2d20Kl1').terms).toEqual([
      { sign: 1, count: 2, sides: 20, keep: { mode: 'lowest', count: 1 } },
    ]);
  });

  it('strips whitespace between tokens but never inside a number', () => {
    expect(parseDice('2d6 + 3d4').expression).toBe('2d6+3d4');
    expect(parseDice(' 2d6+3d4 ').expression).toBe('2d6+3d4');
    expect(parseDice('2d6\t+\t3d4').expression).toBe('2d6+3d4');
    // Stripping these would join the digits into a different number.
    for (const source of ['2 0d6', '2d6+1 4', '1 0d6+2', '2d6 + 1 4', '2d6\t1 4']) {
      expect(() => parseDice(source), `should reject ${JSON.stringify(source)}`).toThrow(DiceError);
    }
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

  it('rejects one-sided dice, which could only explode forever', () => {
    // A die explodes while it shows its maximum, so sides < MIN_SIDES can never
    // evaluate. `d1!` (the review's example) is rejected here, at parse time.
    expect(MIN_SIDES).toBeGreaterThan(1);
    for (const source of ['d1', '1d1', '3d1', '2d1kh1', 'd1!', '1d1!']) {
      expect(() => parseDice(source), `should reject ${source}`).toThrow(DiceError);
    }
    expect(parseDice('2d2').terms).toEqual([{ sign: 1, count: 2, sides: 2 }]);
  });

  it('rejects the unsupported exploding and drop syntax outright', () => {
    // The grammar has no `!` marker and no drop, so these are errors rather than
    // half-supported: `2d6dl2` cannot drop every die because it drops nothing.
    for (const source of ['2d6!', '!2d6', '2d6kh1!', '2d6dl2', '2d6dl1', '2d6dl0', '2d6dh1']) {
      expect(() => parseDice(source), `should reject ${source}`).toThrow(DiceError);
    }
  });

  it('rejects absurd sizes', () => {
    expect(() => parseDice('1001d20')).toThrow(DiceError);
    expect(() => parseDice('2d1001')).toThrow(DiceError);
    expect(() => parseDice('2d999999999999999999999999')).toThrow(DiceError);
    expect(() => parseDice('999999999999999999999999d6')).toThrow(DiceError);
    expect(() => parseDice(`${'9d6 + '.repeat(MAX_TERMS)}1d6`)).toThrow(DiceError);
    expect(() => parseDice(`${'101d6+'.repeat(MAX_TERMS - 1)}101d6`)).toThrow(DiceError);
    expect(() => parseDice(`2d6+${'2d6+'.repeat(MAX_EXPRESSION_LENGTH / 4 + 1)}`)).toThrow(
      DiceError,
    );
  });

  it('caps flat modifiers, so a total can never be Infinity', () => {
    expect(parseDice(`2d6+${String(MAX_MODIFIER)}`).modifier).toBe(MAX_MODIFIER);
    expect(parseDice(`2d6-${String(MAX_MODIFIER)}`).modifier).toBe(-MAX_MODIFIER);
    expect(parseDice(`+${String(MAX_MODIFIER)}`).modifier).toBe(MAX_MODIFIER);
    // One past the cap, on both signs and with no dice at all.
    expect(() => parseDice(`2d6+${String(MAX_MODIFIER + 1)}`)).toThrow(DiceError);
    expect(() => parseDice(`2d6-${String(MAX_MODIFIER + 1)}`)).toThrow(DiceError);
    expect(() => parseDice(`+${String(MAX_MODIFIER + 1)}`)).toThrow(DiceError);
    // Within the digit cap but past the value cap.
    expect(() => parseDice(`2d6+${'9'.repeat(MAX_MODIFIER_DIGITS)}`)).toThrow(DiceError);

    // `parseInt` of this is Infinity, and Infinity serialises to null in JSON.
    const overflow = '9'.repeat(400);
    expect(MAX_MODIFIER_DIGITS).toBeLessThan(overflow.length);
    for (const source of [`d6+${overflow}`, `2d6+${overflow}`, `+${overflow}`, `-${overflow}`]) {
      expect(() => parseDice(source)).toThrow(DiceError);
      expect(() => parseDice(source)).toThrow(/flat modifier exceeds/);
    }
    const result = rollDice(`2d6+${String(MAX_MODIFIER)}`, facesRng([1, 1]));
    expect(Number.isFinite(result.total)).toBe(true);
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
    expect(evaluateDice(parsed, cyclingRng())).toEqual(evaluateDice(parsed, cyclingRng()));
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

  it('sums equal dice the same whichever rank is kept', () => {
    // Ties are value-equal, so kh and kl agree on the total.
    expect(rollDice('2d6kh1', facesRng([3, 3]))).toEqual({ values: [3, 3], total: 3 });
    expect(rollDice('2d6kl1', facesRng([3, 3]))).toEqual({ values: [3, 3], total: 3 });
    expect(rollDice('4d6kh2', facesRng([5, 5, 5, 5]))).toEqual({ values: [5, 5, 5, 5], total: 10 });
  });

  it('exploding dice reroll on the maximum; the die is the chain sum', () => {
    // 1d4: 4 (explode), 4 (explode), 2 -> die = 4+4+2 = 10.
    const result = rollDice('1d4', facesRng([4, 4, 2]));
    expect(result).toEqual({ values: [4, 4, 2], total: 10 });
  });

  it('a die that lands on the maximum adds the reroll to its own value', () => {
    // 1d6: 6 (explode), 1 -> one die worth 7; the 1 could not explode again.
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

  it('rejects an rng draw outside the requested range', () => {
    // The injected stream is a trust boundary: NaN or ±Infinity in a total
    // serialises to null, so a bad draw is a typed error, not a silent total.
    const parsed = parseDice('2d6');
    for (const bad of [
      0,
      -1,
      7,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      expect(() => evaluateDice(parsed, () => bad), `should reject ${String(bad)}`).toThrow(
        DiceError,
      );
    }
    expect(evaluateDice(parsed, facesRng([1, 2]))).toEqual({ values: [1, 2], total: 3 });
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
  const modArb = fc.integer({ min: -MAX_MODIFIER, max: MAX_MODIFIER });

  /** `[count, sides, keepCount in 1..count, keepsHighest]` for one term. */
  const termArb = countArb.chain((count) =>
    fc.tuple(fc.constant(count), sidesArb, fc.integer({ min: 1, max: count }), fc.boolean()),
  );

  // Builds `3d6kh2` / `-3d6kl1` style sources; the keep count always fits `count`.
  const sourceFor = (
    count: number,
    sides: number,
    k: number,
    highest: boolean,
    negative: boolean,
    mod: number,
  ): string =>
    `${negative ? '-' : ''}${String(count)}d${String(sides)}${highest ? 'kh' : 'kl'}${String(k)}` +
    (mod === 0 ? '' : `${mod > 0 ? '+' : ''}${String(mod)}`);

  const rollArb = countArb.chain((count) =>
    fc.tuple(
      fc.constant(count),
      sidesArb,
      fc.integer({ min: 1, max: count }),
      fc.boolean(),
      fc.boolean(),
      modArb,
    ),
  );

  it('parses every well-formed expression it generates', () => {
    fc.assert(
      fc.property(rollArb, ([count, sides, k, highest, negative, mod]) => {
        // Upper case throughout: parsing must be case-insensitive.
        const source =
          `${negative ? '-' : ''}${String(count)}D${String(sides)}${highest ? 'KH' : 'KL'}${String(k)}` +
          (mod === 0 ? '' : `${mod > 0 ? '+' : ''}${String(mod)}`);
        // parseDice throws on malformed input, so reaching the assertions at all
        // proves parsing succeeded — no silent early return.
        const parsed = parseDice(source);
        expect(parsed.terms).toEqual([
          {
            sign: negative ? -1 : 1,
            count,
            sides,
            keep: { mode: highest ? 'highest' : 'lowest', count: k },
          },
        ]);
        expect(parsed.modifier).toBe(mod);
        expect(parsed.baseRolls).toBe(count);
      }),
    );
  });

  it('keeps exactly the k best dice, matching a sort-based reference', () => {
    const arb = countArb.chain((count) =>
      fc.tuple(
        fc.constant(count),
        sidesArb,
        fc.integer({ min: 1, max: count }),
        fc.boolean(),
        fc.integer({ min: 0, max: 10_000 }),
      ),
    );
    fc.assert(
      fc.property(arb, ([count, sides, k, highest, seed]) => {
        // Faces cycle 1..sides-1, so they differ per die and none is the maximum.
        const faces = Array.from({ length: count }, (_, i) => 1 + ((seed + i) % (sides - 1)));
        const parsed = parseDice(sourceFor(count, sides, k, highest, false, 0));
        const result = evaluateDice(parsed, facesRng(faces));
        expect(result.values).toEqual(faces);
        const sorted = [...faces].sort((a, b) => a - b);
        const expected = (highest ? sorted.slice(count - k) : sorted.slice(0, k)).reduce(
          (sum, value) => sum + value,
          0,
        );
        expect(result.total).toBe(expected);
      }),
    );
  });

  it('bounds a non-exploding roll within its kept-face bounds', () => {
    fc.assert(
      fc.property(rollArb, ([count, sides, k, highest, negative, mod]) => {
        const parsed = parseDice(sourceFor(count, sides, k, highest, negative, mod));
        // cappedRng draws 1..sides-1, so no die ever explodes.
        const result = evaluateDice(parsed, cappedRng());
        const [min, max] = negative
          ? [mod - k * (sides - 1), mod - k]
          : [mod + k, mod + k * (sides - 1)];
        expect(result.total).toBeGreaterThanOrEqual(min);
        expect(result.total).toBeLessThanOrEqual(max);
        expect(result.values).toHaveLength(count);
        expect(Number.isInteger(result.total)).toBe(true);
      }),
    );
  });

  it('bounds an exploding roll whose rng reaches the maximum', () => {
    fc.assert(
      fc.property(rollArb, ([count, sides, k, highest, negative, mod]) => {
        const parsed = parseDice(sourceFor(count, sides, k, highest, negative, mod));
        // cyclingRng draws every face of 1..sides, the maximum included, and the
        // cycle restarts at 1 straight after the maximum: a die explodes at most
        // once, so its value is at most sides + 1.
        const result = evaluateDice(parsed, cyclingRng());
        const [min, max] = negative
          ? [mod - k * (sides + 1), mod - k]
          : [mod + k, mod + k * (sides + 1)];
        expect(result.total).toBeGreaterThanOrEqual(min);
        expect(result.total).toBeLessThanOrEqual(max);
        expect(result.values.length).toBeGreaterThanOrEqual(count);
        expect(result.values.length).toBeLessThanOrEqual(MAX_TOTAL_ROLLS);
        for (const value of result.values) {
          expect(value).toBeGreaterThanOrEqual(1);
          expect(value).toBeLessThanOrEqual(sides);
        }
      }),
    );
  });

  it('keeps every total and recorded value an integer for signed rolls', () => {
    const arb = fc
      .array(termArb, { minLength: 1, maxLength: 4 })
      .chain((terms) => fc.tuple(fc.constant(terms), modArb));
    fc.assert(
      fc.property(arb, ([terms, mod]) => {
        const source =
          terms
            .map(([count, sides, k, highest], index) => {
              const sign = index === 0 ? '' : index % 2 === 0 ? '+' : '-';
              return `${sign}${String(count)}d${String(sides)}${highest ? 'kh' : 'kl'}${String(k)}`;
            })
            .join('') + (mod === 0 ? '' : `${mod > 0 ? '+' : ''}${String(mod)}`);
        const result = rollDice(source, cyclingRng());
        expect(Number.isInteger(result.total)).toBe(true);
        for (const value of result.values) expect(Number.isInteger(value)).toBe(true);
        expect(result.values.length).toBeLessThanOrEqual(MAX_TOTAL_ROLLS);
      }),
    );
  });

  it('is deterministic for the same rng stream', () => {
    fc.assert(
      fc.property(rollArb, ([count, sides, k, highest, negative, mod]) => {
        const parsed = parseDice(sourceFor(count, sides, k, highest, negative, mod));
        expect(evaluateDice(parsed, cyclingRng())).toEqual(evaluateDice(parsed, cyclingRng()));
      }),
    );
  });

  it('stops a never-ending exploding roll at MAX_TOTAL_ROLLS draws', () => {
    fc.assert(
      fc.property(countArb, sidesArb, (count, sides) => {
        const result = rollDice(`${String(count)}d${String(sides)}`, (_min, max) => max);
        expect(result.values).toHaveLength(MAX_TOTAL_ROLLS);
        expect(result.total).toBe(sides * MAX_TOTAL_ROLLS);
      }),
      { numRuns: 10 },
    );
  });
});

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

  it('rejects the shapes the parser can never produce', () => {
    const parsed = parseDice('2d20kh1+5');
    expect(() =>
      ParsedRollSchema.parse({ ...parsed, terms: [{ sign: 1, count: 1, sides: 1 }] }),
    ).toThrow();
    expect(() =>
      ParsedRollSchema.parse({ ...parsed, terms: [{ sign: 1, count: 1, sides: MAX_SIDES + 1 }] }),
    ).toThrow();
    expect(() => ParsedRollSchema.parse({ ...parsed, modifier: MAX_MODIFIER + 1 })).toThrow();
    expect(() =>
      ParsedRollSchema.parse({
        ...parsed,
        terms: [{ sign: 1, count: 1, sides: 6, keep: { mode: 'sideways', count: 1 } }],
      }),
    ).toThrow();
  });
});
