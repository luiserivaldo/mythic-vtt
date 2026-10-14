import type { LayerId } from '@mythic/shared';
import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { DEFAULT_ACTIVE_LAYER, toggleHidden } from './layer-panel.js';

/**
 * Local, per-client view state. Nothing here is game state (§0 rule 1): selection, hidden layers
 * and the active layer are never sent to the host. The renderer/picking lane writes
 * `selectedEntityId`.
 */
export interface UiState {
  selectedEntityId: string | null;
  hiddenLayers: ReadonlySet<LayerId>;
  /** UI-LAY-01: where new entities and props go. Local to this viewer. */
  activeLayer: LayerId;
  select: (entityId: string | null) => void;
  toggleLayerHidden: (layer: LayerId) => void;
  setActiveLayer: (layer: LayerId) => void;
}

export function createUiStore(): StoreApi<UiState> {
  return createStore<UiState>()((set, get) => ({
    selectedEntityId: null,
    hiddenLayers: new Set<LayerId>(),
    activeLayer: DEFAULT_ACTIVE_LAYER,
    select: (selectedEntityId) => {
      set({ selectedEntityId });
    },
    toggleLayerHidden: (layer) => {
      set({ hiddenLayers: toggleHidden(get().hiddenLayers, layer) });
    },
    setActiveLayer: (activeLayer) => {
      set({ activeLayer });
    },
  }));
}

export const UiStoreContext = createContext<StoreApi<UiState> | null>(null);

export function useUiStore<T>(selector: (s: UiState) => T): T {
  const store = useContext(UiStoreContext);
  if (!store) throw new Error('useUiStore outside UiStoreContext.Provider');
  return useStore(store, selector);
}
