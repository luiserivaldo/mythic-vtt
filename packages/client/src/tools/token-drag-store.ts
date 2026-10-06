import type { Vec3 } from '@mythic/shared';
import { createStore } from 'zustand/vanilla';

/** Render-local drag in progress (or waiting for the host's answer). Never game state. */
export interface LocalDrag {
  sceneId: string;
  entityId: string;
  /** Where the token was when the press began; used to detect the host's patch landing. */
  base: Vec3;
  to: Vec3;
  settling: boolean;
}

/** Another client's ephemeral preview, drawn as a ghost until it expires or the move lands. */
export interface RemotePreview {
  sceneId: string;
  entityId: string;
  to: Vec3;
  at: number;
}

interface DragState {
  local: LocalDrag | null;
  remote: Record<string, RemotePreview>;
  setLocal(local: LocalDrag | null): void;
  setRemote(from: string, preview: RemotePreview | null): void;
  pruneRemote(now: number, ttlMs: number): void;
}

export const tokenDragStore = createStore<DragState>()((set) => ({
  local: null,
  remote: {},
  setLocal: (local) => {
    set({ local });
  },
  setRemote: (from, preview) => {
    set((state) => {
      const others = Object.entries(state.remote).filter(([key]) => key !== from);
      const remote = Object.fromEntries(preview ? [...others, [from, preview]] : others);
      return { remote };
    });
  },
  pruneRemote: (now, ttlMs) => {
    set((state) => {
      const entries = Object.entries(state.remote);
      const kept = entries.filter(([, p]) => now - p.at < ttlMs);
      return kept.length === entries.length ? state : { remote: Object.fromEntries(kept) };
    });
  },
}));
