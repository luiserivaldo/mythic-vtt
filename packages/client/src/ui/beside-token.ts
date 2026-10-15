import { createStore } from 'zustand/vanilla';

// UI-TOKEN-02 / principle 3 (MV-239): the selected entity's panels open beside it, over the board.
// Local view state only; nothing here is sent to the host.

/**
 * The selected entity's screen footprint, in pixels from the board's top-left corner: its left and
 * right sides and its vertical centre. Null when no single entity is selected or it is not drawn.
 */
export interface SelectionAnchor {
  left: number;
  right: number;
  y: number;
}

interface SelectionAnchorState {
  anchor: SelectionAnchor | null;
  setAnchor(anchor: SelectionAnchor | null): void;
}

const same = (a: SelectionAnchor | null, b: SelectionAnchor | null) =>
  a === null || b === null
    ? a === b
    : Math.abs(a.left - b.left) < 0.5 &&
      Math.abs(a.right - b.right) < 0.5 &&
      Math.abs(a.y - b.y) < 0.5;

export const selectionAnchorStore = createStore<SelectionAnchorState>()((set, get) => ({
  anchor: null,
  // The canvas reports every rendered frame; sub-pixel moves are dropped so an idle board does
  // not re-place the panel.
  setAnchor: (anchor) => {
    if (!same(get().anchor, anchor)) set({ anchor });
  },
}));

/** The gap keeps the panel clear of the token's 2D handles; the margin keeps it off the edges. */
export const BESIDE_GAP_PX = 24;
export const BESIDE_MARGIN_PX = 8;

interface Size {
  width: number;
  height: number;
}

/**
 * Where the panel's top-left corner goes. It prefers the token's left side, because the token's
 * own menus (UI-TOKEN-02/03) open on its right; with no room there it flips to the right side.
 * It never covers the rail (`minLeft`) and stays inside the board. With no anchor (nothing drawn
 * for the selection) it sits beside the rail at the top of the board.
 */
export function besideTokenPlacement(
  anchor: SelectionAnchor | null,
  panel: Size,
  board: Size,
  minLeft: number,
): { left: number; top: number } {
  const maxLeft = Math.max(minLeft, board.width - BESIDE_MARGIN_PX - panel.width);
  const maxTop = Math.max(BESIDE_MARGIN_PX, board.height - BESIDE_MARGIN_PX - panel.height);
  const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
  if (!anchor) return { left: minLeft, top: BESIDE_MARGIN_PX };
  const before = anchor.left - BESIDE_GAP_PX - panel.width;
  const after = anchor.right + BESIDE_GAP_PX;
  const left =
    before >= minLeft ? before : after + panel.width <= board.width - BESIDE_MARGIN_PX ? after : 0;
  return {
    left: Math.round(clamp(left, minLeft, maxLeft)),
    top: Math.round(clamp(anchor.y - panel.height / 2, BESIDE_MARGIN_PX, maxTop)),
  };
}
