import { z } from 'zod';
import { Id } from './ids.js';

export const MAX_ROUND = 1000000;
/** UI-TOOL-05: the largest initiative score; decimals are allowed to break ties. */
export const MAX_INITIATIVE_VALUE = 9999;
// zod 4 numbers already reject NaN and Infinity.
export const InitiativeValue = z.number().min(-MAX_INITIATIVE_VALUE).max(MAX_INITIATIVE_VALUE);
export const Initiative = z
  .strictObject({
    round: z.number().int().min(1).max(MAX_ROUND),
    order: z.array(Id).max(200),
    activeEntityId: Id.nullable(),
    // Save v10 (UX-38): per-combatant scores and the sort direction. Absent means unscored and
    // descending, so a v9 initiative keeps its order unchanged.
    values: z.record(Id, InitiativeValue).optional(),
    ascending: z.boolean().optional(),
  })
  .refine(
    (value) =>
      new Set(value.order).size === value.order.length &&
      (value.activeEntityId === null || value.order.includes(value.activeEntityId)) &&
      Object.keys(value.values ?? {}).every((id) => value.order.includes(id)),
    { message: 'initiative requires a unique order, an active member and scored members' },
  );
export type Initiative = z.infer<typeof Initiative>;

export function nextInitiative(value: Initiative): Initiative | undefined {
  if (value.order.length === 0) return undefined;
  const index = value.activeEntityId === null ? -1 : value.order.indexOf(value.activeEntityId);
  const next = (index + 1) % value.order.length;
  const round = value.round + (index >= 0 && next === 0 ? 1 : 0);
  if (round > MAX_ROUND) return undefined;
  return { ...value, round, activeEntityId: value.order[next] ?? null };
}

/** The turn before the current one; stepping back past the first turn returns to the last round. */
export function previousInitiative(value: Initiative): Initiative | undefined {
  if (value.activeEntityId === null) return undefined;
  const index = value.order.indexOf(value.activeEntityId);
  const wraps = index <= 0;
  if (wraps && value.round <= 1) return undefined;
  const previous = wraps ? value.order.length - 1 : index - 1;
  return {
    ...value,
    round: value.round - (wraps ? 1 : 0),
    activeEntityId: value.order[previous] ?? null,
  };
}

/**
 * UI-TOOL-05: order combatants by score, highest first unless `ascending`. Unscored combatants
 * follow the scored ones, and ties keep their current relative order so a re-sort never shuffles.
 */
export function sortInitiative(value: Initiative): Initiative {
  const values = value.values ?? {};
  const direction = value.ascending ? 1 : -1;
  const order = value.order
    .map((id, index) => ({ id, index, score: values[id] }))
    .sort((a, b) => {
      if (a.score === undefined || b.score === undefined) {
        if (a.score === b.score) return a.index - b.index;
        return a.score === undefined ? 1 : -1;
      }
      return a.score === b.score ? a.index - b.index : direction * (a.score - b.score);
    })
    .map((entry) => entry.id);
  return { ...value, order };
}
