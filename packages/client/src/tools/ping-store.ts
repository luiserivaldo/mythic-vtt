import { createStore } from 'zustand/vanilla';
import { MAX_ACTIVE_PINGS, pingExpired, type PingMarker } from './ping.js';

/** A marker as the wire and the board produce it; the store assigns the React key. */
export type PingInput = Omit<PingMarker, 'key'>;

/**
 * Render-local ping markers (LAY-05). Nothing here is game state and nothing is sent from here:
 * the sender is broadcast by `PingTool` through the ephemeral channel, and every client keeps its
 * own copy until the marker's short life ends. Markers of other scenes are kept but only drawn for
 * the active one, so browsing away and back does not resurrect them (they simply expire).
 */
interface PingState {
  readonly markers: readonly PingMarker[];
  /** Bumped by the board's Ping button; `PingTool` pings the centre of the view for each new value. */
  readonly centreRequests: number;
  add(input: PingInput): void;
  /** Drops the markers whose life has ended; a no-op keeps the current array identity. */
  prune(nowMs: number): void;
  requestCentre(): void;
  clear(): void;
}

export const pingStore = createStore<PingState>()((set) => {
  let nextKey = 1;
  return {
    markers: [],
    centreRequests: 0,
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
    requestCentre: () => {
      set((state) => ({ centreRequests: state.centreRequests + 1 }));
    },
    clear: () => {
      set({ markers: [] });
    },
  };
});
