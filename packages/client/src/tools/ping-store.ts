import { createStore } from 'zustand/vanilla';
import { MAX_ACTIVE_PINGS, pingExpired, type PingMarker } from './ping.js';

/** A marker as the wire and the board produce it; the store assigns the React key. */
export type PingInput = Omit<PingMarker, 'key'>;

/**
 * UX-40: where a right-click menu wants to ping: a spot under the pointer (normalised device
 * coordinates, so 2D and 3D share it) or a token's ground point in scene units.
 */
export type PingRequest =
  | { readonly kind: 'ndc'; readonly x: number; readonly y: number }
  | { readonly kind: 'point'; readonly x: number; readonly z: number };

/**
 * Render-local ping markers (LAY-05). Nothing here is game state and nothing is sent from here:
 * the sender is broadcast by `PingTool` through the ephemeral channel, and every client keeps its
 * own copy until the marker's short life ends. Markers of other scenes are kept but only drawn for
 * the active one, so browsing away and back does not resurrect them (they simply expire).
 */
interface PingState {
  readonly markers: readonly PingMarker[];
  /** Bumped by each menu ping; `PingTool` pings `request` for each new value. */
  readonly requests: number;
  readonly request: PingRequest | null;
  add(input: PingInput): void;
  /** Drops the markers whose life has ended; a no-op keeps the current array identity. */
  prune(nowMs: number): void;
  requestAt(request: PingRequest): void;
  clear(): void;
}

export const pingStore = createStore<PingState>()((set) => {
  let nextKey = 1;
  return {
    markers: [],
    requests: 0,
    request: null,
    add: (input) => {
      set((state) => {
        const markers = [...state.markers, { ...input, key: nextKey++ }];
        return {
          markers:
            markers.length > MAX_ACTIVE_PINGS
              ? markers.slice(markers.length - MAX_ACTIVE_PINGS)
              : markers,
        };
      });
    },
    prune: (nowMs) => {
      set((state) => {
        const markers = state.markers.filter((marker) => !pingExpired(marker, nowMs));
        return markers.length === state.markers.length ? state : { markers };
      });
    },
    requestAt: (request) => {
      set((state) => ({ requests: state.requests + 1, request }));
    },
    clear: () => {
      set({ markers: [] });
    },
  };
});
