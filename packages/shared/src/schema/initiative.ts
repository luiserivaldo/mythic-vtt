import { z } from 'zod';
import { Id } from './ids.js';

export const MAX_ROUND = 1000000;
export const Initiative = z
  .strictObject({
    round: z.number().int().min(1).max(MAX_ROUND),
    order: z.array(Id).max(200),
    activeEntityId: Id.nullable(),
  })
  .refine(
    (value) =>
      new Set(value.order).size === value.order.length &&
      (value.activeEntityId === null || value.order.includes(value.activeEntityId)),
    { message: 'initiative requires a unique order and an active member' },
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
