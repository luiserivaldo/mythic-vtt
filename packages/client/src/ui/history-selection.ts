/** Mirrors the host's list of actions that cannot be undone (engine/undo.ts); the host decides. */
const NOT_UNDOABLE = /^(?:history|session|seat)\.|^scene\.(?:activate|delete)$/;

export function isUndoableType(type: string): boolean {
  return !NOT_UNDOABLE.test(type);
}

export interface Selection {
  selected: ReadonlySet<number>;
  /** The entry the last click landed on; a Shift-click extends from it. */
  anchor?: number;
}

export type SelectMode = 'only' | 'toggle' | 'range';

/**
 * History-log selection, like a file list: plain click selects one, Ctrl/Cmd-click toggles,
 * Shift-click selects the run between the anchor and the click. `order` is the displayed order of
 * the selectable entries; ones that cannot be undone are left out of it.
 */
export function select(
  current: Selection,
  order: readonly number[],
  seq: number,
  mode: SelectMode,
): Selection {
  if (!order.includes(seq)) return current;
  if (mode === 'toggle') {
    const selected = new Set(current.selected);
    if (selected.has(seq)) selected.delete(seq);
    else selected.add(seq);
    return { selected, anchor: seq };
  }
  if (mode === 'range' && current.anchor !== undefined && order.includes(current.anchor)) {
    const a = order.indexOf(current.anchor);
    const b = order.indexOf(seq);
    const run = order.slice(Math.min(a, b), Math.max(a, b) + 1);
    return { selected: new Set([...current.selected, ...run]), anchor: current.anchor };
  }
  return { selected: new Set([seq]), anchor: seq };
}

/** Drop selected entries that are no longer listed (after a refresh or a filter change). */
export function prune(current: Selection, order: readonly number[]): Selection {
  const listed = new Set(order);
  const selected = new Set([...current.selected].filter((seq) => listed.has(seq)));
  return selected.size === current.selected.size ? current : { ...current, selected };
}
