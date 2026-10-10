import type { Vec3 } from '@mythic/shared';
import { createStore } from 'zustand/vanilla';
import type { RemoteRuler } from './ruler.js';

/** Render-local ruler state (MEAS-01). Never game state; only relayed through ephemerals. */
interface RulerState {
  /** The Ruler tool is armed (board toolbar button or `R`). */
  tool: boolean;
  /** Keep a completed press-drag ruler until it is replaced or explicitly cleared. */
  persistent: boolean;
  mode: '2d' | '3d';
  snap: boolean;
  broadcast: boolean;
  measureMovement: boolean;
  setPreferences(
    patch: Partial<Pick<RulerState, 'mode' | 'snap' | 'broadcast' | 'measureMovement'>>,
  ): void;
  /** `idle` has nothing drawn; `active` is placing waypoints; `finished` keeps the readout up. */
  phase: 'idle' | 'active' | 'finished';
  sceneId: string | null;
  points: readonly Vec3[];
  cursor: Vec3 | null;
  remote: Readonly<Record<string, RemoteRuler>>;
  setTool(tool: boolean): void;
  setPersistent(persistent: boolean): void;
  begin(sceneId: string, first: Vec3): void;
  setPoints(points: readonly Vec3[]): void;
  setCursor(cursor: Vec3 | null): void;
  finish(): void;
  clear(): void;
  setRemote(from: string, ruler: RemoteRuler | null): void;
  pruneRemote(expired: (ruler: RemoteRuler) => boolean): void;
}

export const rulerStore = createStore<RulerState>()((set) => ({
  tool: false,
  persistent: false,
  mode: '2d',
  snap: true,
  broadcast: true,
  measureMovement: true,
  setPreferences: (patch) => {
    set(
      patch.mode === undefined
        ? patch
        : { ...patch, phase: 'idle', points: [], cursor: null, sceneId: null },
    );
  },
  phase: 'idle',
  sceneId: null,
  points: [],
  cursor: null,
  remote: {},
  setTool: (tool) => {
    set(tool ? { tool } : { tool, phase: 'idle', sceneId: null, points: [], cursor: null });
  },
  setPersistent: (persistent) => {
    set({ persistent });
  },
  begin: (sceneId, first) => {
    set({ phase: 'active', sceneId, points: [first], cursor: null });
  },
  setPoints: (points) => {
    set({ points });
  },
  setCursor: (cursor) => {
    set({ cursor });
  },
  finish: () => {
    set({ phase: 'finished', cursor: null });
  },
  clear: () => {
    set({ phase: 'idle', sceneId: null, points: [], cursor: null });
  },
  setRemote: (from, ruler) => {
    set((state) => {
      const others = Object.entries(state.remote).filter(([key]) => key !== from);
      return { remote: Object.fromEntries(ruler ? [...others, [from, ruler]] : others) };
    });
  },
  pruneRemote: (expired) => {
    set((state) => {
      const entries = Object.entries(state.remote);
      const kept = entries.filter(([, ruler]) => !expired(ruler));
      return kept.length === entries.length ? state : { remote: Object.fromEntries(kept) };
    });
  },
}));
