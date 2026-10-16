import { createStore } from 'zustand/vanilla';
import { aoeToolStore } from '../tools/aoe-tool-store.js';
import { rulerStore } from '../tools/ruler-store.js';
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
  /** Expands the pane for a new selection, or, while measuring, once measuring ends. */
  revealSelection(): void;
}

/** The ruler or an AoE template is armed: both start from a board drag (M3-15). */
function measuring(): boolean {
  return rulerStore.getState().tool || aoeToolStore.getState().active;
}

// MV-267: the pane collapsed itself for Measure and reopens when measuring ends.
let tuckedForMeasure = false;

export const leftPaneStore = createStore<LeftPaneState>()((set) => ({
  container: null,
  collapsed: false,
  setContainer: (container) => {
    set({ container });
  },
  toggleCollapsed: () => {
    tuckedForMeasure = false;
    set((state) => ({ collapsed: !state.collapsed }));
  },
  expand: () => {
    tuckedForMeasure = false;
    set({ collapsed: false });
  },
  revealSelection: () => {
    if (measuring()) tuckedForMeasure = true;
    else set({ collapsed: false });
  },
}));

/**
 * MV-267 (MV-279): the pane floats over the board's left edge, so an open pane would take the
 * press of a ruler or AoE drag aimed at the cells under it. Measure's panel opens beside its rail
 * button, not in the pane, so arming Measure collapses the pane to its strip and disarming it
 * reopens the pane if Measure closed it. The pane keeps normal pointer input: expanding it while
 * measuring is the user's choice, and its controls stay clickable. Draw and Create Prop keep their
 * panels in the pane, so they leave it open.
 */
let wasMeasuring = measuring();
function followMeasuring() {
  const now = measuring();
  if (now === wasMeasuring) return;
  wasMeasuring = now;
  const pane = leftPaneStore.getState();
  if (now) {
    if (!pane.collapsed) {
      leftPaneStore.setState({ collapsed: true });
      tuckedForMeasure = true;
    }
  } else if (tuckedForMeasure) {
    pane.expand();
  }
}
rulerStore.subscribe(followMeasuring);
aoeToolStore.subscribe(followMeasuring);

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
