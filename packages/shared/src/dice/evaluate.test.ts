import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { evaluateDice, ExplosionLimitError } from './evaluate.js';
import type { DiceTermResult, RollFn, RollResult, RolledDie } from './evaluate.js';
import { parseDice, MAX_EXPLOSIONS } from './parse.js';

/** Deterministic stand-in for the injected RNG: pops scripted values. */
const scripted = (values: number[]): RollFn => {
  let i = 0;
  return (sides: number) => {
    const v = values[i] ?? sides;
    i += 1;
    return v;
  };
};

const evalExpr = (text: string, roll: RollFn) => {
  const parsed = parseDice(text);
  if (!parsed.ok) throw new Error(`parse failed: ${JSON.stringify(parsed.error)}`);
  return evaluateDice(parsed.expr, roll);
};

const diceTerm = (result: RollResult, i: number): DiceTermResult => {
  const term = result.terms[i];
  if (term === undefined || term.kind !== 'dice')
    throw new Error(`term ${String(i)} is not a dice term`);
  return term;
};

/** The kept dice of a term with their roll chains. */
const keptDice = (term: DiceTermResult): RolledDie[] => term.dice.filter((d) => d.kept);

describe('evaluateDice: flat and plain dice', () => {
  it('rolls a single d20 (1 die, N defaults to 1)', () => {
    const result = evalExpr('d20', scripted([17]));
    expect(result.total).toBe(17);
    expect(result.terms).toHaveLength(1);
  });

  it('sums plain dice and reports the flat total', () => {
    const result = evalExpr('2d6', scripted([3, 5]));
    expect(result.total).toBe(8);
    expect(diceTerm(result, 0).sum).toBe(8);
  });

  it('applies flat modifiers, including subtraction', () => {
    const result = evalExpr('1d8+1d6-2', scripted([8, 6]));
    expect(result.total).toBe(12);
    expect(result.terms.map((t) => t.kind)).toEqual(['dice', 'dice', 'flat']);
  });

  it('handles negative flat terms', () => {
    const result = evalExpr('d4-3', scripted([4]));
    expect(result.total).toBe(1);
  });
});

describe('evaluateDice: keep and drop', () => {
  it('keeps only the highest die', () => {
    const result = evalExpr('2d20kh1', scripted([3, 17]));
    const term = diceTerm(result, 0);
    expect(keptDice(term).map((d) => d.value)).toEqual([17]);
    expect(term.sum).toBe(17);
    expect(result.total).toBe(17);
  });

  it('keeps the lowest die', () => {
    const result = evalExpr('2d20kl1', scripted([17, 3]));
    const term = diceTerm(result, 0);
    expect(keptDice(term).map((d) => d.value)).toEqual([3]);
    expect(term.sum).toBe(3);
  });

  it('keeps all dice (keep count equals the dice count)', () => {
    const result = evalExpr('3d6kh3', scripted([2, 4, 6]));
    const term = diceTerm(result, 0);
    expect(term.dice.every((d) => d.kept)).toBe(true);
    expect(term.sum).toBe(12);
  });

  it('keeps a subset of dice', () => {
    const result = evalExpr('4d6kh2', scripted([1, 6, 3, 5]));
    const term = diceTerm(result, 0);
    expect(
      keptDice(term)
        .map((d) => d.value)
        .sort((a, b) => b - a),
    ).toEqual([6, 5]);
    expect(term.sum).toBe(11);
  });

  it('drops the highest die', () => {
    const result = evalExpr('4d6dh1', scripted([1, 6, 3, 5]));
    const term = diceTerm(result, 0);
    expect(
      keptDice(term)
        .map((d) => d.value)
        .sort((a, b) => a - b),
    ).toEqual([1, 3, 5]);
    expect(term.sum).toBe(9);
  });

  it('drops the lowest die', () => {
    const result = evalExpr('4d6dl1', scripted([1, 6, 3, 5]));
    const term = diceTerm(result, 0);
    expect(
      keptDice(term)
        .map((d) => d.value)
        .sort((a, b) => a - b),
    ).toEqual([3, 5, 6]);
    expect(term.sum).toBe(14);
  });

  it('drop can leave a single die (4d6dl3)', () => {
    const result = evalExpr('4d6dl3', scripted([2, 5, 1, 4]));
    const term = diceTerm(result, 0);
    expect(keptDice(term).map((d) => d.value)).toEqual([5]);
    expect(term.sum).toBe(5);
  });

  it('breaks keep/drop ties by earliest roll (deterministic)', () => {
    const result = evalExpr('2d6kh1', scripted([5, 5]));
    const term = diceTerm(result, 0);
    expect(term.dice.map((d) => d.kept)).toEqual([true, false]);
    expect(term.sum).toBe(5);
  });
});

describe('evaluateDice: exploding', () => {
  it('adds the re-roll after a maximum (add semantics)', () => {
    const result = evalExpr('d6!', scripted([6, 4]));
    const term = diceTerm(result, 0);
    expect(term.dice[0]?.value).toBe(10);
    expect(term.dice[0]?.rolls).toEqual([
      { value: 6, exploded: true },
      { value: 4, exploded: false },
    ]);
    expect(result.total).toBe(10);
  });

  it('chains explosions until the cap is hit, then reports it', () => {
    // Always-max roll: 100 explosions then the report.
    const alwaysMax: RollFn = (sides) => sides;
    expect(() => evalExpr('d6!', alwaysMax)).toThrow(ExplosionLimitError);
    try {
      evalExpr('d6!', alwaysMax);
      expect.unreachable('expected ExplosionLimitError');
    } catch (error) {
      expect(error).toBeInstanceOf(ExplosionLimitError);
      if (error instanceof ExplosionLimitError) {
        expect(error.sides).toBe(6);
        expect(error.limit).toBe(MAX_EXPLOSIONS);
      }
    }
  });

  it('allows exactly MAX_EXPLOSIONS explosions (the boundary)', () => {
    // The cap permits MAX_EXPLOSIONS exploded rolls: 100 maxes, then the 101st
    // roll (a non-max) closes the chain.
    const values = Array.from({ length: MAX_EXPLOSIONS }, () => 6);
    values.push(3);
    const result = evalExpr('d6!', scripted(values));
    const term = diceTerm(result, 0);
    expect(term.dice[0]?.rolls).toHaveLength(MAX_EXPLOSIONS + 1);
    expect(term.dice[0]?.value).toBe(MAX_EXPLOSIONS * 6 + 3);
  });

  it('reports the explosion cap per die', () => {
    const alwaysMax: RollFn = (sides) => sides;
    expect(() => evalExpr('2d4!', alwaysMax)).toThrow(ExplosionLimitError);
  });

  it('a non-maximum does not explode', () => {
    const result = evalExpr('d6!', scripted([3]));
    const term = diceTerm(result, 0);
    expect(term.dice[0]?.rolls).toEqual([{ value: 3, exploded: false }]);
    expect(term.sum).toBe(3);
  });
});

describe('evaluateDice: determinism and structure', () => {
  it('is fully determined by the injected roll (same script, same result)', () => {
    const a = evalExpr('2d20kh1+5', scripted([3, 17]));
    const b = evalExpr('2d20kh1+5', scripted([3, 17]));
    expect(a).toEqual(b);
    expect(a.total).toBe(22);
  });

  it('reports which dice were dropped in the per-die result', () => {
    const result = evalExpr('4d6dl1', scripted([1, 6, 3, 5]));
    const term = diceTerm(result, 0);
    expect(term.dice.map((d) => d.kept)).toEqual([false, true, true, true]);
    expect(term.sum).toBe(14);
  });

  it('marks the exploded rolls in the chain', () => {
    const result = evalExpr('d6!', scripted([6, 6, 2]));
    const term = diceTerm(result, 0);
    expect(term.dice[0]?.rolls.map((r) => r.exploded)).toEqual([true, true, false]);
  });

  it('keeps integers: total, sums, values and flat terms are integers', () => {
    const result = evalExpr('2d6+1d4-3', scripted([6, 1, 4]));
    expect(Number.isInteger(result.total)).toBe(true);
    for (const t of result.terms) {
      if (t.kind === 'dice') {
        expect(Number.isInteger(t.sum)).toBe(true);
        for (const die of t.dice) {
          expect(Number.isInteger(die.value)).toBe(true);
          for (const r of die.rolls) expect(Number.isInteger(r.value)).toBe(true);
        }
      } else {
        expect(Number.isInteger(t.value)).toBe(true);
      }
    }
  });
});

describe('evaluateDice: boundaries', () => {
  it('max dice in one term (100d6)', () => {
    const values = Array.from({ length: 100 }, () => 3);
    const result = evalExpr('100d6', scripted(values));
    expect(result.total).toBe(300);
    expect(diceTerm(result, 0).dice).toHaveLength(100);
  });

  it('a 1-sided die always contributes 1', () => {
    const result = evalExpr('3d1', scripted([1, 1, 1]));
    expect(result.total).toBe(3);
    expect(diceTerm(result, 0).sum).toBe(3);
  });

  it('an exploding 1-sided die always maxes, so it hits the cap', () => {
    // Every roll of a d1 is the maximum, so `d1!` never terminates naturally —
    // the cap has to stop it.
    expect(() => evalExpr('d1!', (sides) => sides)).toThrow(ExplosionLimitError);
  });

  it('keeps min and max within the term bounds', () => {
    const result = evalExpr('2d20kh1', scripted([20, 1]));
    const term = diceTerm(result, 0);
    expect(term.sum).toBeGreaterThanOrEqual(term.min);
    expect(term.sum).toBeLessThanOrEqual(term.max);
  });
});

describe('evaluateDice: property tests', () => {
  const int = (min: number, max: number) => fc.integer({ min, max });

  // Valid expressions within the caps, plus a flat term. Exploding is excluded:
  // a property roll can never be the max of a d1 (every value of a d1 IS the
  // max), so exploding expressions would not terminate.
  const exprArb = fc
    .tuple(
      int(1, 100),
      int(1, 1000),
      fc.option(fc.tuple(fc.boolean(), fc.boolean()), { nil: undefined }), // keep/drop: [keep?, high?]
      int(-5, 5),
    )
    .map(([count, sides, kd, flat]) => {
      let suffix = '';
      if (kd !== undefined) {
        const [keep, high] = kd;
        // Keep/drop count within the dice count.
        const k: number = 1;
        suffix = keep
          ? high
            ? `kh${String(k)}`
            : `kl${String(k)}`
          : high
            ? `dh${String(k)}`
            : `dl${String(k)}`;
      }
      const sign = flat >= 0 ? '+' : '-';
      return `${String(count)}d${String(sides)}${suffix}${sign}${String(Math.abs(flat))}`;
    });

  it('the total lies within the computed minimum and maximum', () => {
    fc.assert(
      fc.property(
        exprArb,
        fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 300 }),
        (exprText, pool) => {
          // In 1..sides, never the max (for sides > 1; a d1 is always 1), so no
          // chain ever re-rolls: bounds are checkable from one pass of the pool.
          const roll: RollFn = (sides) =>
            sides === 1 ? 1 : 1 + ((pool[(sides * 7) % pool.length] ?? 1) % (sides - 1));
          const parsed = parseDice(exprText);
          if (!parsed.ok) return; // the generator only makes valid expressions
          const result = evaluateDice(parsed.expr, roll);
          let min = 0;
          let max = 0;
          for (const t of result.terms) {
            if (t.kind === 'dice') {
              min += t.min;
              max += t.max;
            } else {
              min += t.value;
              max += t.value;
            }
          }
          expect(result.total).toBeGreaterThanOrEqual(min);
          expect(result.total).toBeLessThanOrEqual(max);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('every evaluated term stays within its own bounds', () => {
    fc.assert(
      fc.property(
        exprArb,
        fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 200 }),
        (exprText, pool) => {
          const roll: RollFn = (sides) =>
            sides === 1 ? 1 : 1 + ((pool[(sides * 7) % pool.length] ?? 1) % (sides - 1));
          const parsed = parseDice(exprText);
          if (!parsed.ok) return;
          const result = evaluateDice(parsed.expr, roll);
          for (const t of result.terms) {
            if (t.kind === 'dice') {
              expect(t.sum).toBeGreaterThanOrEqual(t.min);
              expect(t.sum).toBeLessThanOrEqual(t.max);
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('keeps integer results for any valid expression and in-range roll', () => {
    fc.assert(
      fc.property(
        exprArb,
        fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 200 }),
        (exprText, pool) => {
          const roll: RollFn = (sides) =>
            sides === 1 ? 1 : 1 + ((pool[(sides * 11) % pool.length] ?? 1) % (sides - 1));
          const parsed = parseDice(exprText);
          if (!parsed.ok) return;
          const result = evaluateDice(parsed.expr, roll);
          expect(Number.isInteger(result.total)).toBe(true);
          for (const t of result.terms) {
            if (t.kind === 'dice') {
              expect(Number.isInteger(t.sum)).toBe(true);
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('evaluateDice: keep/drop sets under a scripted roll', () => {
  it('kh2 of 4d6 keeps exactly the two largest values', () => {
    const result = evalExpr('4d6kh2', scripted([1, 6, 3, 5]));
    const term = diceTerm(result, 0);
    expect(keptDice(term).map((d) => d.value)).toEqual([6, 5]);
    expect(term.dice.map((d) => d.kept)).toEqual([false, true, false, true]);
  });

  it('dl1 drops exactly the smallest value', () => {
    const result = evalExpr('4d6dl1', scripted([4, 1, 3, 2]));
    const term = diceTerm(result, 0);
    expect(term.dice.map((d) => d.kept)).toEqual([true, false, true, true]);
    expect(term.sum).toBe(4 + 3 + 2);
  });
});
