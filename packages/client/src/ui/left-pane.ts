import { createStore } from 'zustand/vanilla';
import { toolPanels, type PanelRegion } from './registries.js';

// UI-SHELL-05: the left pane is local view state. Nothing here is sent to the host.

interface LeftPaneState {
  /** The in-flow slot beside the board that the pane portals into (set by the shell). */
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
