import type { Draft } from 'immer';
import type { z } from 'zod';
import type { Campaign, Seat } from '../schema/index.js';
import type { Actor, ActionEnvelope } from './envelope.js';

/**
 * Method syntax on purpose: it makes `permission`/`reduce` bivariant so that definitions with
 * different payload types fit in one registry array without `any`.
 */
export interface ActionDefinition<T extends string, S extends z.ZodType> {
  readonly type: T;
  readonly schema: S;
  /** Must return false for spectators and unknown seats. Host is allowed unless there is a reason. */
  permission(state: Campaign, actor: Actor, payload: z.infer<S>): boolean;
  /** Pure: no time, randomness or I/O. Use `envelope.ts` / `envelope.rng`. */
  reduce(draft: Draft<Campaign>, envelope: ActionEnvelope<T, z.infer<S>>): void;
  /** May mods submit this action (still subject to their manifest)? */
  readonly modExposed: boolean;
}

export function defineAction<const T extends string, S extends z.ZodType>(
  def: ActionDefinition<T, S>,
): ActionDefinition<T, S> {
  return def;
}

export type AnyAction = ActionDefinition<string, z.ZodType>;

export function isHost(actor: Actor): boolean {
  return actor.kind === 'host';
}

/**
 * The seat an actor sits in. A "seat" actor whose seatId is missing or unknown is a spectator
 * or stale connection: it resolves to undefined and must be denied (spectators are connections,
 * not seats; TECHNICAL.md §5).
 */
export function seatOf(state: Campaign, actor: Actor): Seat | undefined {
  if (actor.kind !== 'seat' || actor.seatId === undefined) return undefined;
  return state.seats[actor.seatId];
}

export function isCoDm(state: Campaign, actor: Actor): boolean {
  return seatOf(state, actor)?.role === 'codm';
}
