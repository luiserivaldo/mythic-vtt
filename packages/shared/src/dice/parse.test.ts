import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { parseDice } from './parse.js';
import { MAX_DICE, MAX_SIDES, MAX_TERMS } from './parse.js';
import type { DiceParseResult } from './parse.js';

const ok = (text: string) => {
  const result: DiceParseResult = parseDice(text);
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.expr;
};

const err = (text: string) => {
  const result: DiceParseResult = parseDice(text);
  if (result.ok) throw new Error(`expected error, got ${JSON.stringify(result.expr)}`);
  return result.error;
};

describe('parseDice: valid notation', () => {
  it('parses NdM', () => {
    expect(ok('2d6')).toEqual({ terms: [{ count: 2, sides: 6, exploding: false }], flat: [] });
  });

  it('defaults N to 1', () => {
    expect(ok('d20')).toEqual({ terms: [{ count: 1, sides: 20, exploding: false }], flat: [] });
  });

  it('parses keep highest with count', () => {
    expect(ok('2d20kh1').terms[0]).toMatchObject({ count: 2, sides: 20, keepHighest: 1 });
  });

  it('parses keep lowest', () => {
    expect(ok('4d6kl2').terms[0]).toMatchObject({ keepLowest: 2 });
  });

  it('parses drop highest', () => {
    expect(ok('4d6dh1').terms[0]).toMatchObject({ dropHighest: 1 });
  });

  it('parses drop lowest', () => {
    expect(ok('4d6dl1').terms[0]).toMatchObject({ dropLowest: 1 });
  });

  it('parses exploding with a prefix bang', () => {
    expect(ok('!2d6').terms[0]).toMatchObject({ exploding: true, count: 2 });
  });

  it('parses exploding with a suffix bang after the sides', () => {
    expect(ok('2d6!').terms[0]).toMatchObject({ exploding: true, count: 2 });
  });

  it('parses a flat modifier after a die term', () => {
    const expr = ok('2d20kh1+5');
    expect(expr.terms).toHaveLength(1);
    expect(expr.flat).toEqual([5]);
  });

  it('parses several die terms with a subtraction', () => {
    const expr = ok('1d8+1d6-2');
    expect(expr.terms.map((t) => [t.count, t.sides])).toEqual([
      [1, 8],
      [1, 6],
    ]);
    expect(expr.flat).toEqual([-2]);
  });

  it('ignores spaces anywhere', () => {
    expect(ok(' 2d20 kh 1 + 5 ')).toEqual(ok('2d20kh1+5'));
    expect(ok('1 d8 + 1 d6 - 2')).toEqual(ok('1d8+1d6-2'));
  });

  it('keeps terms in order, flats separate', () => {
    const expr = ok('3d6+2+1d4-1');
    expect(expr.terms.map((t) => t.sides)).toEqual([6, 4]);
    expect(expr.flat).toEqual([2, -1]);
  });
});

describe('parseDice: rejections', () => {
  it('rejects empty input', () => {
    expect(err('')).toEqual({ code: 'empty', input: '' });
    expect(err('   ')).toMatchObject({ code: 'empty' });
  });

  it('rejects input with no die term', () => {
    expect(err('5')).toMatchObject({ code: 'no-dice' });
    expect(err('2-3')).toMatchObject({ code: 'no-dice' });
  });

  it('rejects zero dice', () => {
    expect(err('0d6')).toMatchObject({ code: 'term', reason: 'bad-count' });
  });

  it('rejects zero sides', () => {
    expect(err('d0')).toMatchObject({ code: 'term', reason: 'bad-sides' });
    expect(err('2d0')).toMatchObject({ code: 'term', reason: 'bad-sides' });
  });

  it('rejects a negative count (a sign in front of a die term)', () => {
    expect(err('-2d6')).toMatchObject({ code: 'term', reason: 'negative-count' });
    expect(err('1d6-3d4')).toMatchObject({ code: 'term', reason: 'negative-count' });
  });

  it('rejects unknown suffixes', () => {
    expect(err('d6x2')).toMatchObject({ code: 'term', reason: 'unknown-suffix' });
    expect(err('2d6kh')).toMatchObject({ code: 'term', reason: 'unknown-suffix' });
    expect(err('2d6xh1')).toMatchObject({ code: 'term', reason: 'unknown-suffix' });
    expect(err('2d6kh1extra')).toMatchObject({ code: 'term', reason: 'unknown-suffix' });
  });

  it('rejects non-integer counts', () => {
    expect(err('2.5d6')).toMatchObject({ code: 'bad-flat' });
    expect(err('d6.5')).toMatchObject({ code: 'term', reason: 'unknown-suffix' });
  });

  it('rejects too many dice in one term', () => {
    expect(err(`${String(MAX_DICE + 1)}d6`)).toMatchObject({
      code: 'term',
      reason: 'too-many-dice',
    });
    expect(ok(`${String(MAX_DICE)}d6`).terms[0]).toMatchObject({ count: MAX_DICE });
  });

  it('rejects too many sides', () => {
    expect(err(`d${String(MAX_SIDES + 1)}`)).toMatchObject({
      code: 'term',
      reason: 'too-many-sides',
    });
    expect(ok(`d${String(MAX_SIDES)}`)).toMatchObject({ terms: [{ count: 1, sides: MAX_SIDES }] });
  });

  it('rejects more than the max number of terms', () => {
    const many = Array.from({ length: MAX_TERMS + 1 }, () => 'd6').join('+');
    expect(err(many)).toMatchObject({ code: 'too-many-terms', count: MAX_TERMS + 1 });
    const atMax = Array.from({ length: MAX_TERMS }, () => 'd6').join('+');
    expect(ok(atMax).terms).toHaveLength(MAX_TERMS);
  });

  it('rejects keep counts larger than the dice count', () => {
    expect(err('2d20kh3')).toMatchObject({ code: 'term', reason: 'keep-too-large' });
  });

  it('rejects drop counts larger than the dice count', () => {
    expect(err('2d20dh3')).toMatchObject({ code: 'term', reason: 'drop-too-large' });
    expect(err('2d20dl3')).toMatchObject({ code: 'term', reason: 'drop-too-large' });
  });

  it('rejects keep zero', () => {
    expect(err('2d20kh0')).toMatchObject({ code: 'term', reason: 'keep-zero' });
    expect(err('2d20kl0')).toMatchObject({ code: 'term', reason: 'keep-zero' });
  });

  it('rejects drop zero', () => {
    expect(err('2d20dh0')).toMatchObject({ code: 'term', reason: 'drop-zero' });
    expect(err('2d20dl0')).toMatchObject({ code: 'term', reason: 'drop-zero' });
  });

  it('rejects double explosion', () => {
    expect(err('!2d6!')).toMatchObject({ code: 'term', reason: 'double-explode' });
  });

  it('rejects garbage tokens', () => {
    expect(err('abc')).toMatchObject({ code: 'bad-flat' });
    expect(err('2d6+')).toMatchObject({ code: 'bad-flat', index: 1, part: '' });
    expect(err('2d6+*3')).toMatchObject({ code: 'bad-flat', part: '*3' });
  });

  it('keeps the failing part and index for debugging', () => {
    expect(err('1d6+2d')).toMatchObject({ code: 'term', index: 1, part: '2d' });
  });
});

describe('parseDice: property tests', () => {
  const int = (min: number, max: number) => fc.integer({ min, max });

  it('never throws on arbitrary strings', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const result = parseDice(s);
        expect(result).toHaveProperty('ok');
      }),
      { numRuns: 500 },
    );
  });

  it('parses every generated valid term back into the same shape', () => {
    fc.assert(
      fc.property(
        // `!` takes exactly one position (prefix or suffix), never both — the
        // double bang is rejected as `double-explode`.
        fc.tuple(int(1, MAX_DICE), int(1, MAX_SIDES), fc.boolean(), fc.boolean()),
        (gen) => {
          const [count, sides, exploding, prefix] = gen;
          const bang = exploding ? '!' : '';
          const text = prefix
            ? `${bang}${String(count)}d${String(sides)}`
            : `${String(count)}d${String(sides)}${bang}`;
          const expr = ok(text);
          expect(expr.terms).toHaveLength(1);
          expect(expr.terms[0]).toMatchObject({ count, sides, exploding });
        },
      ),
      { numRuns: 300 },
    );
  });

  it('parses generated keep/drop suffixes within the dice count', () => {
    fc.assert(
      fc.property(
        fc.tuple(int(1, MAX_DICE), int(1, MAX_SIDES), fc.boolean(), fc.boolean(), int(1, MAX_DICE)),
        (gen) => {
          const [count, sides, keepNotDrop, highNotLow, rawK] = gen;
          const k = Math.min(rawK, count);
          const prefix = keepNotDrop ? (highNotLow ? 'kh' : 'kl') : highNotLow ? 'dh' : 'dl';
          const expr = ok(`${String(count)}d${String(sides)}${prefix}${String(k)}`);
          const term = expr.terms[0];
          if (keepNotDrop) expect(term?.[highNotLow ? 'keepHighest' : 'keepLowest']).toBe(k);
          else expect(term?.[highNotLow ? 'dropHighest' : 'dropLowest']).toBe(k);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('rejects generated expressions past the term cap', () => {
    const many = Array.from({ length: MAX_TERMS + 1 }, () => 'd6').join('+');
    expect(parseDice(many)).toMatchObject({ ok: false, error: { code: 'too-many-terms' } });
  });
});
