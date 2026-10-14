import { createStore } from 'zustand/vanilla';

interface TokenMenuState {
  /** The token whose full menu is open near it, if any. */
  entityId: string | null;
  /** The token whose right-click menu is open, if any. Only one menu shows at a time. */
  contextEntityId: string | null;
  open(entityId: string): void;
  openContext(entityId: string): void;
  /** Closes both menus (an empty selection, or the board losing focus). */
  close(): void;
  /** Closes a menu whose token is no longer selected; local view state never outlives selection. */
  reconcile(selected: readonly string[]): void;
}

/**
 * UI-TOKEN-01 / UI-TOKEN-02 / UI-TOKEN-03: the preview card's gear and a token double-click open
 * the full menu; a right click opens the short menu. Both are local view state (PERM-01) — never
 * sent to the host, never logged. One menu at a time: opening either closes the other.
 */
export const tokenMenuStore = createStore<TokenMenuState>()((set, get) => ({
  entityId: null,
  contextEntityId: null,
  open: (entityId) => {
    set({ entityId, contextEntityId: null });
  },
  openContext: (entityId) => {
    set({ entityId: null, contextEntityId: entityId });
  },
  close: () => {
    set({ entityId: null, contextEntityId: null });
  },
  reconcile: (selected) => {
    const { entityId, contextEntityId } = get();
    const keep = (id: string | null) => (id !== null && selected.includes(id) ? id : null);
    const next = { entityId: keep(entityId), contextEntityId: keep(contextEntityId) };
    if (next.entityId !== entityId || next.contextEntityId !== contextEntityId) set(next);
  },
}));
