// Evaluator for parsed dice expressions. ACT-02. Pure: all randomness comes from the
// injected `roll` (the only I/O boundary); the evaluator itself never touches
// `Math.random` (shared is pure, see AGENTS.md §2).

import { MAX_EXPLOSIONS } from './parse.js';
import type { DiceExpression, DiceTerm } from './parse.js';

/**
 * One physical roll of one die, in the order rolled. For an exploding die the
 * chain is recorded: every roll before the last has `exploded: true` (it hit the
 * maximum and triggered a re-roll); the final roll has `exploded: false`.
 */
export interface DieRoll {
  value: number;
  exploded: boolean;
}

/**
 * The per-die result of one term. `value` is the die's total contribution — for
 * an exploding die this is the sum of its whole chain (standard exploding
 * semantics: a max re-rolls and the new roll is added). `kept` says whether the
 * die counts toward the term total.
 */
export interface RolledDie {
  rolls: DieRoll[];
  value: number;
  kept: boolean;
}

/** Per-term evaluation, in expression order: die terms first, then flat terms. */
export interface DiceTermResult {
  kind: 'dice';
  term: DiceTerm;
  dice: RolledDie[];
  /** Sum of `dice` where `kept` is true (after keep/drop and explosion resolution). */
  sum: number;
  /** Smallest value this term can produce (no explosions assumed). */
  min: number;
  /** Largest value this term can produce within the explosion cap. */
  max: number;
}

/** A flat `+N`/`-N` term. */
export interface FlatTermResult {
  kind: 'flat';
  value: number;
}

export type EvaluatedTerm = DiceTermResult | FlatTermResult;

/** The full result of evaluating an expression. */
export interface RollResult {
  terms: EvaluatedTerm[];
  /** Sum of all term contributions (dice terms use their kept-dice sum). */
  total: number;
}

/**
 * Randomness boundary: returns an integer in `1..sides` (inclusive). Injected so
 * `@mythic/shared` stays pure; the evaluator calls nothing else for randomness.
 */
export type RollFn = (sides: number) => number;

/** Why an exploding die was stopped. */
export class ExplosionLimitError extends Error {
  readonly sides: number;
  readonly limit: number;

  constructor(sides: number, limit: number) {
    super(`Exploding d${String(sides)} reached the ${String(limit)}-roll limit`);
    this.name = 'ExplosionLimitError';
    this.sides = sides;
    this.limit = limit;
  }
}

/**
 * Evaluates a parsed expression with an injected `roll`. Returns the total and the
 * per-term breakdown (which dice were kept or dropped, which exploded) so a chat
 * message can show them. Throws `ExplosionLimitError` if an exploding die hits
 * its maximum more than `MAX_EXPLOSIONS` times.
 */
export const evaluateDice = (expr: DiceExpression, roll: RollFn): RollResult => {
  const terms: EvaluatedTerm[] = [];
  let total = 0;

  for (const term of expr.terms) {
    const result = evaluateTerm(term, roll);
    terms.push(result);
    total += result.sum;
  }

  for (const flat of expr.flat) {
    const result: FlatTermResult = { kind: 'flat', value: flat };
    terms.push(result);
    total += flat;
  }

  return { terms, total };
};

/** Evaluates a single die term, resolving explosions and keep/drop. */
const evaluateTerm = (term: DiceTerm, roll: RollFn): DiceTermResult => {
  const dice: RolledDie[] = [];
  for (let i = 0; i < term.count; i++) {
    const rolls: DieRoll[] = [];
    let value = roll(term.sides);
    // Exploding (add semantics): a maximum re-rolls and the new roll is added.
    // The cap makes this terminate on any `roll`, even one that always returns
    // the max: after `MAX_EXPLOSIONS` explosions one more is reported.
    while (term.exploding && value === term.sides) {
      if (rolls.length >= MAX_EXPLOSIONS) {
        throw new ExplosionLimitError(term.sides, MAX_EXPLOSIONS);
      }
      rolls.push({ value, exploded: true });
      value = roll(term.sides);
    }
    rolls.push({ value, exploded: false });
    const total = rolls.reduce((acc, r) => acc + r.value, 0);
    dice.push({ rolls, value: total, kept: true });
  }

  // Keep/drop: mark which dice count toward the term sum; a term with no keep/drop
  // keeps everything. Ties are broken by earliest roll so results are deterministic.
  const keptFlags = selectKept(dice, term);
  dice.forEach((die, i) => {
    die.kept = keptFlags[i] ?? false;
  });

  const sum = dice.reduce((acc, die, i) => (keptFlags[i] ? acc + die.value : acc), 0);

  return {
    kind: 'dice',
    term,
    dice,
    sum,
    min: minSum(term),
    max: maxSum(term),
  };
};

/** Which dice survive keep/drop, in roll order (ties broken by earliest roll). */
const selectKept = (dice: RolledDie[], term: DiceTerm): boolean[] => {
  const n = dice.length;
  const kept: boolean[] = new Array<boolean>(n).fill(true);

  let mode: 'keep' | 'drop' | null = null;
  let ranked: number[] = [];
  let count = 0;
  if (term.keepHighest !== undefined) {
    mode = 'keep';
    ranked = rank(dice, 'desc');
    count = term.keepHighest;
  } else if (term.keepLowest !== undefined) {
    mode = 'keep';
    ranked = rank(dice, 'asc');
    count = term.keepLowest;
  } else if (term.dropHighest !== undefined) {
    mode = 'drop';
    ranked = rank(dice, 'desc');
    count = term.dropHighest;
  } else if (term.dropLowest !== undefined) {
    mode = 'drop';
    ranked = rank(dice, 'asc');
    count = term.dropLowest;
  }
  if (mode === null) return kept;

  if (mode === 'keep') kept.fill(false);
  for (let i = 0; i < count && i < ranked.length; i++) {
    const index = ranked[i];
    if (index !== undefined) kept[index] = mode === 'keep';
  }
  return kept;
};

/** Indices of `dice` sorted by value, ties broken by earliest roll. */
const rank = (dice: RolledDie[], order: 'asc' | 'desc'): number[] => {
  const entries = dice.map((die, index) => ({ value: die.value, index }));
  entries.sort((a, b) =>
    order === 'desc'
      ? b.value - a.value || a.index - b.index
      : a.value - b.value || b.index - a.index,
  );
  return entries.map((entry) => entry.index);
};

/**
 * The smallest value the term can produce: each kept die contributes at least 1
 * (an explosion only adds rolls, each ≥ 1, so it can only raise the total).
 */
const minSum = (term: DiceTerm): number => keepCount(term);

/**
 * The largest value the term can produce within the explosion cap: each kept die
 * is at most `(MAX_EXPLOSIONS + 1) * sides` — `MAX_EXPLOSIONS` exploded maxima
 * plus the final max. Non-exploding dice are at most `sides`.
 */
const maxSum = (term: DiceTerm): number => {
  const perDie = term.exploding ? (MAX_EXPLOSIONS + 1) * term.sides : term.sides;
  return keepCount(term) * perDie;
};

/** How many dice count toward the sum after keep/drop (validated in parsing). */
const keepCount = (term: DiceTerm): number => {
  if (term.keepHighest !== undefined) return term.keepHighest;
  if (term.keepLowest !== undefined) return term.keepLowest;
  if (term.dropHighest !== undefined) return term.count - term.dropHighest;
  if (term.dropLowest !== undefined) return term.count - term.dropLowest;
  return term.count;
};
