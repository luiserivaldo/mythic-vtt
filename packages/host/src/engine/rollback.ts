import { applyPatches } from 'immer';
import {
  Campaign,
  ROLLBACK_MAX_PATCHES,
  diffPatches,
  isHost,
  type Actor,
  type HistoryRollbackPayload,
  type RollbackRequest,
} from '@mythic/shared';
import type { LogEntry } from '../storage/types.js';

// HIST-07: the host decides what a rollback does. It rebuilds the target state by undoing the
// logged inverse patches, newest first, from the live state, then logs the net difference as one
// action. Nothing is erased: the log only ever grows.

/** The log entries the engine may read, newest first, in chunks (the history viewer's reader). */
export type LogReader = () => AsyncIterable<readonly LogEntry[]>;

/** How many log entries one rollback may walk; further back is refused, not slowed down. */
export const ROLLBACK_MAX_ENTRIES = 20_000;

/**
 * Parts of the campaign a rollback leaves alone. Seats are people and their bindings (a rollback
 * must not unseat anyone, and seats only grow, so every owner reference in an older state still
 * resolves); the rest is campaign identity and table configuration. Everything else (scenes,
 * the active scene, prefabs) returns to the target point.
 */
export const ROLLBACK_KEEPS = ['id', 'name', 'schemaVersion', 'settings', 'seats'] as const;

export type RollbackPlan =
  | { ok: true; payload: HistoryRollbackPayload }
  | { ok: false; reason: 'forbidden' | 'conflict'; detail?: string };

const conflict = (detail: string): RollbackPlan => ({ ok: false, reason: 'conflict', detail });

export async function planRollback(args: {
  state: Campaign;
  seq: number;
  actor: Actor;
  request: RollbackRequest;
  readLog: LogReader | undefined;
}): Promise<RollbackPlan> {
  const { state, seq, actor, request, readLog } = args;
  if (!isHost(actor)) return { ok: false, reason: 'forbidden' };
  const { toSeq } = request;
  if (toSeq >= seq) return conflict('no such point');
  if (!readLog) return conflict('history is not available');

  // Undo seq, seq-1, ..., toSeq+1 against the live state. Entries must be contiguous: a gap
  // means a log that cannot answer for the target point, and a guess would be worse than no.
  let rewound: unknown = state;
  let expected = seq;
  let walked = 0;
  try {
    walk: for await (const chunk of readLog()) {
      for (const entry of chunk) {
        if (expected <= toSeq) break walk;
        if (entry.envelope.seq !== expected) return conflict('no such point');
        if (++walked > ROLLBACK_MAX_ENTRIES) return conflict('too far back; pick a nearer point');
        rewound = applyPatches(rewound as Campaign, entry.inversePatches);
        expected -= 1;
      }
      if (expected <= toSeq) break;
    }
  } catch {
    return conflict('cannot be rolled back');
  }
  if (expected > toSeq) return conflict('no such point');

  // Validate, but diff the rewound value itself: a parsed copy would lose the structural sharing
  // `diffPatches` relies on and report every array as changed.
  if (!Campaign.safeParse(rewound).success) return conflict('cannot be rolled back');
  const target: Campaign = { ...(rewound as Campaign) };
  for (const key of ROLLBACK_KEEPS) (target as Record<string, unknown>)[key] = state[key];
  if (target.activeSceneId !== null && target.scenes[target.activeSceneId] === undefined)
    return conflict('cannot be rolled back');

  const patches = diffPatches(state, target);
  if (patches.length > ROLLBACK_MAX_PATCHES) return conflict('too far back; pick a nearer point');
  try {
    // Dry run: a rollback must land on a state that is still a campaign.
    if (!Campaign.safeParse(applyPatches(state, patches)).success)
      return conflict('cannot be rolled back');
  } catch {
    return conflict('cannot be rolled back');
  }
  return { ok: true, payload: { toSeq, patches } };
}
