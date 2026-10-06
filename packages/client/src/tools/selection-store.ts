import { createStore } from 'zustand/vanilla';
import { nextSelection } from './selection.js';

interface SelectionState {
  sceneId: string | null;
  ids: string[];
  pick(sceneId: string, id: string | null, additive: boolean): void;
  reconcile(sceneId: string | null, ids: readonly string[]): void;
  clear(): void;
}

/** Board interaction state is local and never enters the game action log. */
export const selectionStore = createStore<SelectionState>()((set, get) => ({
  sceneId: null,
  ids: [],
  pick(sceneId, id, additive) {
    const current = get();
    set({
      sceneId,
      ids: nextSelection(current.sceneId === sceneId ? current.ids : [], id, additive),
    });
  },
  reconcile(sceneId, ids) {
    const current = get();
    const next = current.sceneId === sceneId ? [...ids] : [];
    if (
      current.sceneId !== sceneId ||
      next.length !== current.ids.length ||
      next.some((id, index) => id !== current.ids[index])
    ) {
      set({ sceneId, ids: next });
    }
  },
  clear() {
    set({ ids: [] });
  },
}));
