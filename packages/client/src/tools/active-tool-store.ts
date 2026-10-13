import { createStore } from 'zustand/vanilla';

/**
 * UI-TOOL-01..05: which rail tool is active. Local view state, never sent to the host. Measure is
 * not held here: it is the ruler/AoE stores' `tool`/`active` flags (one pointer owner, M3-15), so
 * the rail reads those and this store only remembers the non-measuring tool to fall back to.
 */
interface ActiveToolState {
  tool: string;
  setTool(tool: string): void;
}

export const activeToolStore = createStore<ActiveToolState>()((set) => ({
  tool: 'select',
  setTool: (tool) => {
    set({ tool });
  },
}));
