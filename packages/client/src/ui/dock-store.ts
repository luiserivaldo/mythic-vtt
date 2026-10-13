import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { DEFAULT_DOCK_TAB } from './dock-tabs.js';

/** UI-TOP-02: local navigation shared by the scene header and dock tabs. */
export const dockStore = createStore<{
  requested: string;
  collapsed: boolean;
  open: (tab: string) => void;
  toggleCollapsed: () => void;
}>()((set) => ({
  requested: DEFAULT_DOCK_TAB,
  collapsed: false,
  open: (requested) => {
    set({ requested, collapsed: false });
  },
  toggleCollapsed: () => {
    set((state) => ({ collapsed: !state.collapsed }));
  },
}));

export function useDockState() {
  return useStore(dockStore);
}
