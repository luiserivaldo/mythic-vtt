import { createStore } from 'zustand/vanilla';

interface TokenMenuState {
  /** The token whose full menu is open near it, if any. */
  entityId: string | null;
  open(entityId: string): void;
  close(): void;
}

/**
 * UI-TOKEN-01 / UI-TOKEN-02: the preview card's gear opens the token's full menu. That menu is
 * local view state (PERM-01) — it is never sent to the host and never logged.
 */
export const tokenMenuStore = createStore<TokenMenuState>()((set) => ({
  entityId: null,
  open: (entityId) => {
    set({ entityId });
  },
  close: () => {
    set({ entityId: null });
  },
}));
