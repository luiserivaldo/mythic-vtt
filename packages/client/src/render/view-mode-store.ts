import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

export type ViewMode = '2d' | '3d';

interface ViewModeState {
  mode: ViewMode;
  toggle(): void;
  set(mode: ViewMode): void;
}

/** `?camera=3d` is kept only as an initial-mode override (tests, deep links). */
export function initialViewMode(search: string): ViewMode {
  return new URLSearchParams(search).get('camera') === '3d' ? '3d' : '2d';
}

/**
 * Per-client view state (Pillar 1): never an action, never sent to the host. The camera,
 * token representation, lighting and skybox all follow it; selection and tools are untouched.
 */
export const viewModeStore = createStore<ViewModeState>()((set, get) => ({
  mode: typeof window === 'undefined' ? '2d' : initialViewMode(window.location.search),
  toggle() {
    set({ mode: get().mode === '2d' ? '3d' : '2d' });
  },
  set(mode) {
    set({ mode });
  },
}));

export function useViewMode(): ViewMode {
  return useStore(viewModeStore, (s) => s.mode);
}
