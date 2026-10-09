import { createStore } from 'zustand/vanilla';

export const TOOL_PANEL_ORDER = ['entities', 'transform', 'aoe'] as const;
export type ToolPanelId = (typeof TOOL_PANEL_ORDER)[number];

interface ToolPanelLayoutState {
  entities: 'hidden' | 'open' | 'collapsed';
  collapsed: Record<Exclude<ToolPanelId, 'entities'>, boolean>;
  toggleEntities(): void;
  hideEntities(): void;
  collapse(panel: ToolPanelId): void;
  restore(panel: ToolPanelId): void;
}

export const toolPanelLayoutStore = createStore<ToolPanelLayoutState>()((set) => ({
  entities: 'hidden',
  collapsed: { transform: false, aoe: false },
  toggleEntities: () => {
    set((state) => ({ entities: state.entities === 'open' ? 'collapsed' : 'open' }));
  },
  hideEntities: () => {
    set({ entities: 'hidden' });
  },
  collapse: (panel) => {
    if (panel === 'entities') {
      set({ entities: 'collapsed' });
      return;
    }
    set((state) => ({ collapsed: { ...state.collapsed, [panel]: true } }));
  },
  restore: (panel) => {
    if (panel === 'entities') {
      set({ entities: 'open' });
      return;
    }
    set((state) => ({ collapsed: { ...state.collapsed, [panel]: false } }));
  },
}));
