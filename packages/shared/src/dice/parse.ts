// Dice notation: `NdM` with keep/drop (`kh`/`kl`/`dh`/`dl`), exploding (`!`), and flat
// terms joined by `+`/`-` (e.g. `2d20kh1+5`). ACT-02. Parsing is pure and total over
// strings: it never throws, it returns a typed result, so callers can surface the
// reason in chat. `!` may prefix the die (`!2d6`) or follow the sides (`2d6!`); a
// sign may not prefix a die term (a minus applies to flat modifiers only), which is
// what makes "negative counts" rejectable.

/** A die term: `NdM` plus optional keep/drop modifiers and the exploding flag. */
export interface DiceTerm {
  count: number;
  sides: number;
  keepHighest?: number;
  keepLowest?: number;
  dropHighest?: number;
  dropLowest?: number;
  exploding: boolean;
}

/** A parsed expression: at least one die term plus flat modifiers. */
export interface DiceExpression {
  terms: DiceTerm[];
  flat: number[];
}

/** Why a single die term failed to parse. */
export type DiceTermPart =
  | 'bad-count'
  | 'negative-count'
  | 'bad-sides'
  | 'too-many-dice'
  | 'too-many-sides'
  | 'double-explode'
  | 'keep-zero'
  | 'drop-zero'
  | 'keep-too-large'
  | 'drop-too-large'
  | 'unknown-suffix';

/** Why a string could not be parsed. */
export type DiceParseError =
  | { code: 'empty'; input: string }
  | { code: 'no-dice'; input: string }
  | { code: 'too-many-terms'; input: string; count: number }
  | { code: 'term'; input: string; index: number; part: string; reason: DiceTermPart }
  | { code: 'bad-flat'; input: string; index: number; part: string };

export type DiceParseResult =
  { ok: true; expr: DiceExpression } | { ok: false; error: DiceParseError };

/** Hard caps so abusive input cannot hang or overflow the evaluator. ACT-02. */
export const MAX_TERMS = 20;
export const MAX_DICE = 100;
export const MAX_SIDES = 1000;
export const MAX_EXPLOSIONS = 100;

const DIGITS = /^[0-9]+$/;
// Loose head (no end anchor, digits optional): decides whether a part is
// dice-shaped at all, before the core below decides what it failed to be.
const DICE_HEAD = /^!?[0-9]*d[0-9]*!?/;
// Die core, matched as a prefix: `[!]N d M[!]` with greedy sides, so the digit
// run stops right before any `!`/`kh1` suffix. Deliberately no `$`: the
// remainder is validated separately as an optional keep/drop suffix.
const DICE_CORE = /^(!?)([0-9]*)d([0-9]+)(!?)?/;
const KEEP_DROP = /^(k|d)(h|l)([0-9]+)$/;

/**
 * Parses `text` into a `DiceExpression`. Never throws; malformed input yields
 * `{ ok: false, error }`. Spaces are ignored anywhere in the input.
 */
export const parseDice = (text: string): DiceParseResult => {
  const input = text.replace(/ /g, '');
  if (input === '') return { ok: false, error: { code: 'empty', input: text } };

  // Split on every +/- boundary; the operator sticks to the following part, so a
  // leading sign survives with its number and a stray operator (e.g. `d6+`) lands
  // in `part` and is rejected there.
  const parts = input.split(/(?=[+-])/);
  if (parts.length > MAX_TERMS) {
    return { ok: false, error: { code: 'too-many-terms', input: text, count: parts.length } };
  }

  const terms: DiceTerm[] = [];
  const flat: number[] = [];
  for (const [i, part] of parts.entries()) {
    const negative = part.startsWith('-');
    const unsigned = part.replace(/^[+-]/, '');

    if (DICE_HEAD.test(unsigned)) {
      if (negative) {
        // A sign in front of a die term would make the count negative; subtraction
        // is only allowed on flat modifiers (see module comment).
        return {
          ok: false,
          error: { code: 'term', input: text, index: i, part: unsigned, reason: 'negative-count' },
        };
      }
      const term = buildTerm(unsigned);
      if (term !== null) {
        terms.push(term);
        continue;
      }
      return {
        ok: false,
        error: {
          code: 'term',
          input: text,
          index: i,
          part: unsigned,
          reason: failureReason(unsigned),
        },
      };
    }
    if (DIGITS.test(unsigned)) {
      flat.push(negative ? -Number(unsigned) : Number(unsigned));
      continue;
    }
    return { ok: false, error: { code: 'bad-flat', input: text, index: i, part: unsigned } };
  }

  // A dice expression must contain at least one die (`5`, `2-3` are not dice).
  if (terms.length === 0) return { ok: false, error: { code: 'no-dice', input: text } };

  return { ok: true, expr: { terms, flat } };
};

/**
 * Builds a term from a dice-shaped string. Returns `null` when a cap is
 * violated, a keep/drop count is out of range, or the leftover suffix is
 * unknown; `failureReason` reports which.
 */
const buildTerm = (unsigned: string): DiceTerm | null => {
  const core = DICE_CORE.exec(unsigned);
  if (core === null) return null;
  const countRaw = core[2] ?? '';
  const count = countRaw === '' ? 1 : Number(countRaw);
  const sides = Number(core[3] ?? '0');
  if (count === 0 || count > MAX_DICE) return null;
  if (sides === 0 || sides > MAX_SIDES) return null;

  const prefixExplode = (core[1] ?? '') === '!';
  const suffixExplode = (core[4] ?? '') === '!';
  if (prefixExplode && suffixExplode) return null;

  // Keep/drop is optional: `2d6` has no suffix, `2d6kh1` does.
  const rest = unsigned.slice(core[0].length);
  const term: DiceTerm = { count, sides, exploding: prefixExplode || suffixExplode };
  if (rest !== '') {
    const suffix = KEEP_DROP.exec(rest);
    if (suffix === null) return null;
    const isKeep = (suffix[1] ?? '') === 'k';
    const isHighest = (suffix[2] ?? '') === 'h';
    const n = Number(suffix[3] ?? '0');
    if (n === 0 || n > count) return null;
    if (isKeep) term[isHighest ? 'keepHighest' : 'keepLowest'] = n;
    else term[isHighest ? 'dropHighest' : 'dropLowest'] = n;
  }
  return term;
};

/** The typed reason for a term that matched the die shape but failed to build. */
const failureReason = (unsigned: string): DiceTermPart => {
  const core = DICE_CORE.exec(unsigned);
  if (core === null) return 'unknown-suffix';
  const count = (core[2] ?? '') === '' ? 1 : Number(core[2] ?? '');
  const sides = Number(core[3] ?? '0');
  if (count === 0) return 'bad-count';
  if (count > MAX_DICE) return 'too-many-dice';
  if (sides === 0) return 'bad-sides';
  if (sides > MAX_SIDES) return 'too-many-sides';
  if ((core[1] ?? '') === '!' && (core[4] ?? '') === '!') return 'double-explode';
  const rest = unsigned.slice(core[0].length);
  if (rest === '') return 'unknown-suffix'; // unreachable: a bare, in-range core builds
  const suffix = KEEP_DROP.exec(rest);
  if (suffix === null) return 'unknown-suffix';
  const isKeep = (suffix[1] ?? '') === 'k';
  const n = Number(suffix[3] ?? '0');
  if (n === 0) return isKeep ? 'keep-zero' : 'drop-zero';
  return isKeep ? 'keep-too-large' : 'drop-too-large';
};
