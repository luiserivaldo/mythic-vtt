import { createStore } from 'zustand/vanilla';

/** A world position the camera should centre on (CAM-06). */
export interface FocusTarget {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface FocusState {
  /** The latest double-click request; a fresh object each time, so a repeat still re-focuses. */
  target: FocusTarget | null;
  request(x: number, y: number, z: number): void;
}

/**
 * CAM-06 camera focus is per-client view state: it is local, never an action and never logged
 * (PERM-01), and it carries a board position only — no token name or identity, so it cannot leak
 * anything the picking rules already hid.
 */
export const focusStore = createStore<FocusState>()((set) => ({
  target: null,
  request(x, y, z) {
    set({ target: { x, y, z } });
  },
}));
