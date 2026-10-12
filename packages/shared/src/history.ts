import { z } from 'zod';
import { Id } from './schema/ids.js';

export const HistoryQuery = z.strictObject({
  before: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  seatId: Id.optional(),
  entityId: Id.optional(),
});
export type HistoryQuery = z.infer<typeof HistoryQuery>;
export const HistoryChange = z.strictObject({
  op: z.enum(['add', 'replace', 'remove']),
  path: z.array(z.union([z.string(), z.number()])),
  value: z.unknown().optional(),
});
export const HistoryEntry = z.strictObject({
  sessionId: Id,
  seq: z.number().int().nonnegative(),
  type: z.string(),
  ts: z.number().nonnegative(),
  seatId: Id.optional(),
  round: z.number().int().nonnegative().optional(),
  turn: z.number().int().nonnegative().optional(),
  changes: z.array(HistoryChange),
});
export type HistoryEntry = z.infer<typeof HistoryEntry>;
export const HistoryPage = z.strictObject({
  entries: z.array(HistoryEntry).max(100),
  before: z.number().int().nonnegative().optional(),
});
export type HistoryPage = z.infer<typeof HistoryPage>;
