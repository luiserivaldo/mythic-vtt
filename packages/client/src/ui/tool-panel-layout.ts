import { createStore } from 'zustand/vanilla';
import { selectionStore } from '../tools/selection-store.js';

// UI-DOCK-01: Entities is now a dock tab, so this stack only holds the selection-driven panels.
export const TOOL_PANEL_ORDER = [
  'transform',
  'aoe',
  'token',
  'ruler',
  'draw',
  'create-prop',
  'initiative',
] as const;
export type ToolPanelId = (typeof TOOL_PANEL_ORDER)[number];

interface ToolPanelLayoutState {
  collapsed: Record<ToolPanelId, boolean>;
  collapse(panel: ToolPanelId): void;
  restore(panel: ToolPanelId): void;
}

export const toolPanelLayoutStore = createStore<ToolPanelLayoutState>()((set) => ({
  // Keep optional token details tucked away so selection does not obscure the table. Transform
  // starts as its chip too (owner ruling on MV-239): open beside the token it covered the
  // neighbour the user hovers for the range readout (MEAS-05).
  collapsed: {
    transform: true,
    aoe: false,
    token: true,
    ruler: false,
    draw: false,
    'create-prop': false,
    initiative: false,
  },
  collapse: (panel) => {
    set((state) => ({ collapsed: { ...state.collapsed, [panel]: true } }));
  },
  restore: (panel) => {
    set((state) => ({ collapsed: { ...state.collapsed, [panel]: false } }));
  },
}));

/**
 * MV-239: each new selection starts with Transform tucked to its chip, so opening it for one token
 * does not leave it covering the board around the next. Only Transform: the user's choice for the
 * other panels carries over, as before.
 */
selectionStore.subscribe((state, previous) => {
  const same =
    state.sceneId === previous.sceneId &&
    state.ids.length === previous.ids.length &&
    state.ids.every((id, index) => id === previous.ids[index]);
  if (!same && !toolPanelLayoutStore.getState().collapsed.transform) {
    toolPanelLayoutStore.getState().collapse('transform');
  }
});
