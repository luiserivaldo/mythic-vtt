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
  'camera',
] as const;
export type ToolPanelId = (typeof TOOL_PANEL_ORDER)[number];

/**
 * UI-TOKEN-07 (MV-266): Transform follows the selection. It shows while something is selected and
 * hides on deselect, with no Close or Restore of its own, so it has no collapse state.
 */
export type CollapsibleToolPanelId = Exclude<ToolPanelId, 'transform'>;

export function isCollapsible(panel: ToolPanelId): panel is CollapsibleToolPanelId {
  return panel !== 'transform';
}

interface ToolPanelLayoutState {
  collapsed: Record<CollapsibleToolPanelId, boolean>;
  collapse(panel: CollapsibleToolPanelId): void;
  restore(panel: CollapsibleToolPanelId): void;
}

export const toolPanelLayoutStore = createStore<ToolPanelLayoutState>()((set) => ({
  // Keep optional token details tucked away so a selection does not crowd the left pane.
  collapsed: {
    aoe: false,
    token: true,
    ruler: false,
    draw: false,
    'create-prop': false,
    initiative: false,
    // UI-CAM-01: the Pan tool's camera panel starts as its bar and expands on demand.
    camera: true,
  },
  collapse: (panel) => {
    set((state) => ({ collapsed: { ...state.collapsed, [panel]: true } }));
  },
  restore: (panel) => {
    set((state) => ({ collapsed: { ...state.collapsed, [panel]: false } }));
  },
}));
