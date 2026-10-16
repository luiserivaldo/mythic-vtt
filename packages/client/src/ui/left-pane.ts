import { createStore } from 'zustand/vanilla';
import type { SelectionAnchor } from './beside-token.js';
import { toolPanels, type PanelRegion } from './registries.js';

// UI-SHELL-05: the left pane is local view state. Nothing here is sent to the host.

interface LeftPaneState {
  /** The slot at the board's left edge that the floating pane portals into (set by the shell). */
  container: HTMLElement | null;
  collapsed: boolean;
  setContainer(container: HTMLElement | null): void;
  toggleCollapsed(): void;
  expand(): void;
}

export const leftPaneStore = createStore<LeftPaneState>()((set) => ({
  container: null,
  collapsed: false,
  setContainer: (container) => {
    set({ container });
  },
  toggleCollapsed: () => {
    set((state) => ({ collapsed: !state.collapsed }));
  },
  expand: () => {
    set({ collapsed: false });
  },
}));

/** The pane's inset from the board's edges (0.5rem). */
export const PANE_MARGIN_PX = 8;
/**
 * Room kept around the selected entity: its 2D handles reach about 58 px past its footprint
 * (UI-TOKEN-07), so a pane closer than this would cover them.
 */
export const PANE_SELECTION_CLEARANCE_PX = 64;

/**
 * MV-279: how far right of its place beside the rail the floating pane moves, in pixels. It moves
 * only when it would cover the selected entity or its handles, and then just past them, if it
 * still fits on the board; otherwise it stays (0). `anchor` is the selection's footprint in board
 * pixels (`SelectionAnchor`), `pane` the pane's unshifted box in the same pixels.
 */
export function paneShift(
  anchor: SelectionAnchor | null,
  pane: { left: number; top: number; width: number; height: number },
  boardWidth: number,
): number {
  if (!anchor) return 0;
  const reach = (anchor.right - anchor.left) / 2 + PANE_SELECTION_CLEARANCE_PX;
  const covers =
    anchor.right + PANE_SELECTION_CLEARANCE_PX > pane.left &&
    anchor.left - PANE_SELECTION_CLEARANCE_PX < pane.left + pane.width &&
    anchor.y + reach > pane.top &&
    anchor.y - reach < pane.top + pane.height;
  if (!covers) return 0;
  const shift = Math.ceil(anchor.right + PANE_SELECTION_CLEARANCE_PX - pane.left);
  return pane.left + shift + pane.width <= boardWidth - PANE_MARGIN_PX ? shift : 0;
}

const devOverrides = new Map<string, PanelRegion>();

/**
 * The region a tool panel opens in. An unregistered panel opens in the left pane: no panel ever
 * opens in the right dock, which holds tabs only (MV-239).
 */
export function panelRegion(id: string): PanelRegion {
  return devOverrides.get(id) ?? toolPanels.get(id)?.region ?? 'left-pane';
}

// Development builds let Playwright route a panel to another region, so the left pane's hosting
// can be checked before any shipped panel is registered to it (UX-37). Takes effect on the next
// render of the tool panels.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__mythicPanelRegions = {
    set(id, region) {
      devOverrides.set(id, region);
    },
  };
}
