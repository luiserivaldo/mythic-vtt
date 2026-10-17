import { applyPatches, type Patch } from 'immer';
import {
  Campaign,
  canUseEntity,
  isHost,
  isLayerLocked,
  type Actor,
  type HistoryUndoPayload,
  type UndoRequest,
  wallSetDoor,
} from '@mythic/shared';

// HIST-04: the host decides what may be undone. It keeps a short in-memory journal of what it
// applied since it started (the Session); entries from earlier runs stay in the History log but
// cannot be undone from here.

type Path = readonly (string | number)[];

export interface JournalEntry {
  seq: number;
  actor: Actor;
  type: string;
  /** Applying these returns the state to what it was before the action. */
  inverse: Patch[];
  /** Paths the action wrote (forward patches). */
  paths: Path[];
  /** For a `history.undo` entry: the seqs it reverted. */
  undoes?: readonly number[];
}

export const JOURNAL_LIMIT = 500;

/**
 * Replaying these inverses would desynchronize bindings or audiences (`seat.*`, `session.*`),
 * or re-activate/delete whole scenes; undo of an undo (redo) is a later feature.
 */
const NOT_UNDOABLE = /^(?:history|session|seat)\.|^scene\.(?:activate|delete)$/;

export function isUndoable(entry: JournalEntry): boolean {
  return !NOT_UNDOABLE.test(entry.type) && entry.inverse.length > 0;
}

const sameActor = (a: Actor, b: Actor): boolean =>
  a.kind === b.kind && a.seatId === b.seatId && a.modId === b.modId;

/** Array positions shift when anything is inserted or removed, so an index touches its array. */
function container(path: Path): Path {
  const index = path.findIndex((segment) => typeof segment === 'number');
  return index === -1 ? path : path.slice(0, index);
}

/** Two writes conflict when one path is the other, or lies inside the other. */
export function pathsOverlap(a: Path, b: Path): boolean {
  const x = container(a);
  const y = container(b);
  const shared = Math.min(x.length, y.length);
  for (let i = 0; i < shared; i++) if (x[i] !== y[i]) return false;
  return true;
}

/**
 * FOG-01 (D47): a seat's door toggle is undone by toggling the door back, so it passes the same
 * gate as `wall.setDoor` itself (the interact permission, a non-secret door in the active scene, and so on)
 * instead of the entity `move` rule, which no player has on a wall. The target door comes from the
 * inverse patch, whose value is the state the undo restores.
 */
function doorUndoAllowed(state: Campaign, actor: Actor, entry: JournalEntry): boolean {
  const [first] = entry.inverse;
  if (!first) return false;
  const [root, sceneId, key, entityId] = first.path;
  if (root !== 'scenes' || key !== 'entities') return false;
  if (typeof sceneId !== 'string' || typeof entityId !== 'string') return false;
  const sameDoor = (patch: Patch) =>
    patch.op === 'replace' &&
    patch.path.length === 7 &&
    patch.path[1] === sceneId &&
    patch.path[3] === entityId &&
    patch.path[4] === 'wall' &&
    patch.path[5] === 'door' &&
    patch.path[6] === 'open' &&
    typeof patch.value === 'boolean';
  if (!entry.inverse.every(sameDoor)) return false;
  const payload = { sceneId, entityId, open: first.value as boolean };
  return (
    wallSetDoor.schema.safeParse(payload).success && wallSetDoor.permission(state, actor, payload)
  );
}

const isDoorToggle = (entry: JournalEntry): boolean => entry.type === wallSetDoor.type;

export type UndoPlan =
  | { ok: true; payload: HistoryUndoPayload }
  | { ok: false; reason: 'forbidden' | 'conflict'; detail?: string };

const forbidden = (detail?: string): UndoPlan => ({
  ok: false,
  reason: 'forbidden',
  ...(detail !== undefined ? { detail } : {}),
});

export function planUndo(args: {
  journal: readonly JournalEntry[];
  state: Campaign;
  actor: Actor;
  request: UndoRequest;
}): UndoPlan {
  const { journal, state, actor, request } = args;
  const host = isHost(actor);
  const undone = new Set<number>();
  for (const entry of journal) for (const seq of entry.undoes ?? []) undone.add(seq);

  let targets: JournalEntry[];
  if (request.targetSeqs === undefined) {
    // Ctrl+Z: the caller's newest action that is still in effect. A seat's door toggle it may no
    // longer make (the interact permission was revoked, the door became secret, ...) is skipped like any
    // other entry it cannot undo, so older moves stay reachable; every reason skips alike.
    const last = [...journal]
      .reverse()
      .find(
        (entry) =>
          sameActor(entry.actor, actor) &&
          isUndoable(entry) &&
          !undone.has(entry.seq) &&
          (host || !isDoorToggle(entry) || doorUndoAllowed(state, actor, entry)),
      );
    if (!last) return forbidden('nothing to undo');
    targets = [last];
  } else {
    const wanted = [...new Set(request.targetSeqs)];
    targets = [];
    for (const seq of wanted) {
      const entry = journal.find((candidate) => candidate.seq === seq);
      // One answer for unknown, someone else's, excluded and already undone, so a seat cannot
      // use this to find out what other people did.
      if (!entry || !isUndoable(entry) || undone.has(seq)) return forbidden();
      if (!host && !sameActor(entry.actor, actor)) return forbidden();
      targets.push(entry);
    }
  }
  targets.sort((a, b) => b.seq - a.seq); // newest first, so later changes are reverted first
  const inBatch = new Set(targets.map((entry) => entry.seq));

  if (!host) {
    for (const target of targets) {
      if (isDoorToggle(target)) {
        if (!doorUndoAllowed(state, actor, target)) return forbidden();
      } else
        for (const patch of target.inverse) {
          const [root, sceneId, key, entityId] = patch.path;
          if (
            root !== 'scenes' ||
            key !== 'entities' ||
            typeof sceneId !== 'string' ||
            typeof entityId !== 'string'
          )
            return forbidden(); // scene, seat and campaign level changes are the DM's to revert
          const scene = state.scenes[sceneId];
          const entity = scene?.entities[entityId];
          // A deleted entity may come back (the seat was allowed to delete it); a live one must
          // still be something this seat may move.
          if (scene && entity) {
            if (isLayerLocked(scene, entity.layer) || !canUseEntity(state, actor, entity, 'move'))
              return forbidden();
          }
        }
      // D34: arrival order wins, so someone else's later write to the same place stands.
      for (const later of journal) {
        if (later.seq <= target.seq || inBatch.has(later.seq) || undone.has(later.seq)) continue;
        // An undo of things newer than the target nets out with them; skip it.
        if (later.undoes?.every((seq) => seq > target.seq)) continue;
        const clash = later.paths.some((written) =>
          target.inverse.some((patch) => pathsOverlap(written, patch.path)),
        );
        if (clash) return { ok: false, reason: 'conflict', detail: 'changed since' };
      }
    }
  }

  const patches = targets.flatMap((target) => target.inverse);
  try {
    // Dry run: the DM may undo over later edits, but never into a state that is not a campaign.
    if (!Campaign.safeParse(applyPatches(state, patches)).success)
      return { ok: false, reason: 'conflict', detail: 'cannot be undone' };
  } catch {
    return { ok: false, reason: 'conflict', detail: 'cannot be undone' };
  }
  return {
    ok: true,
    payload: { targetSeqs: targets.map((entry) => entry.seq), patches: patches },
  };
}
