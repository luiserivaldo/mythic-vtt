import { createStore } from 'zustand/vanilla';

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
  // Keep optional token details tucked away so selection does not obscure the table.
  collapsed: {
    transform: false,
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
