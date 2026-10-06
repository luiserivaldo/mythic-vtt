import { z } from 'zod';
import { Id } from '../schema/index.js';

// TECHNICAL.md §4.1 (contract).
export const Actor = z.object({
  kind: z.enum(['host', 'seat', 'mod']),
  seatId: Id.optional(),
  modId: z.string().optional(),
  identityId: Id.optional(),
});
export type Actor = z.infer<typeof Actor>;

export const ActionEnvelope = z.object({
  id: Id,
  type: z.string().min(1),
  payload: z.unknown(),
  actor: Actor,
  campaignId: Id,
  sceneId: Id.optional(),
  sessionId: Id,
  seq: z.number().int().nonnegative(),
  ts: z.number().nonnegative(),
  round: z.number().int().nonnegative().optional(),
  turn: z.number().int().nonnegative().optional(),
  rng: z.array(z.number()).optional(),
  clientRef: z.string().optional(),
});
export type ActionEnvelope<T extends string = string, P = unknown> = Omit<
  z.infer<typeof ActionEnvelope>,
  'type' | 'payload'
> & { type: T; payload: P };
