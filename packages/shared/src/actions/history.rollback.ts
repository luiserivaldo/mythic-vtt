import { applyPatches, type Patch } from 'immer';
import { z } from 'zod';
import { defineAction, isHost } from './define.js';
import { UndoPatch } from './history.undo.js';
import { removeArchivedOwners } from './archived-owners.js';

/** Most patches one rollback may carry; a bigger jump back is refused ("pick a nearer point"). */
export const ROLLBACK_MAX_PATCHES = 20_000;

/**
 * What a client may send (HIST-07): only the point to return to. The host never trusts anything
 * else; it builds the logged payload (`HistoryRollbackPayload`) from its own log.
 */
export const RollbackRequest = z.strictObject({ toSeq: z.number().int().positive() });
export type RollbackRequest = z.infer<typeof RollbackRequest>;

/**
 * The logged form. Reducers cannot read the log and recovery replays the logged envelope, so the
 * net change from the live state to the target state travels inside the payload. Only the host
 * engine produces this; the intent path parses `RollbackRequest` and ignores anything else.
 */
export const HistoryRollbackPayload = z.strictObject({
  toSeq: z.number().int().positive(),
  patches: z.array(UndoPatch).max(ROLLBACK_MAX_PATCHES),
});
export type HistoryRollbackPayload = z.infer<typeof HistoryRollbackPayload>;

/**
 * HIST-07: rollback is a new action, not an erasure; the log is never truncated. Host only: a
 * co-DM can see the DM layer but must not be able to rewrite it wholesale.
 */
export const historyRollback = defineAction({
  type: 'history.rollback',
  schema: HistoryRollbackPayload,
  permission: (_state, actor) => isHost(actor),
  reduce: (draft, a) => {
    applyPatches(draft, a.payload.patches as Patch[]);
    removeArchivedOwners(draft);
  },
  modExposed: false,
});
