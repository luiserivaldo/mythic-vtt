import { applyPatches, type Patch } from 'immer';
import { z } from 'zod';
import { defineAction, isHost, seatOf } from './define.js';
import { removeArchivedOwners } from './archived-owners.js';

/**
 * What a client may send (HIST-04). Omitting `targetSeqs` means "undo my last action" (Ctrl+Z);
 * naming seqs is the DM's History-log selection. The host never trusts anything else: it builds
 * the logged payload itself (`HistoryUndoPayload`) from its own journal.
 */
export const UndoRequest = z.strictObject({
  targetSeqs: z.array(z.number().int().positive()).min(1).max(50).optional(),
});
export type UndoRequest = z.infer<typeof UndoRequest>;

export const UndoPatch = z.strictObject({
  op: z.enum(['add', 'replace', 'remove']),
  path: z.array(z.union([z.string(), z.number()])),
  value: z.unknown().optional(),
});

/**
 * The logged form. Reducers cannot read the log and recovery replays the logged envelope, so the
 * inverse patches travel inside the payload. Only the host engine produces this; the intent path
 * for `history.undo` parses `UndoRequest` and ignores everything else a client sends.
 */
export const HistoryUndoPayload = z.strictObject({
  targetSeqs: z.array(z.number().int().positive()).min(1).max(50),
  patches: z.array(UndoPatch).max(5000),
});
export type HistoryUndoPayload = z.infer<typeof HistoryUndoPayload>;

/**
 * HIST-04: undo is a new action, not an erasure. The host decides which entries may be undone
 * (own actions for a seat, anything for the DM, no later action touching the same paths); this
 * definition only checks that the actor can act at all and applies the patches.
 */
export const historyUndo = defineAction({
  type: 'history.undo',
  schema: HistoryUndoPayload,
  permission: (state, actor) => isHost(actor) || seatOf(state, actor) !== undefined,
  reduce: (draft, a) => {
    applyPatches(draft, a.payload.patches as Patch[]);
    removeArchivedOwners(draft);
  },
  modExposed: false,
});
