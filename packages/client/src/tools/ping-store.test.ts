import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_ACTIVE_PINGS, PING_TTL_MS, type PingMarker } from './ping.js';
import { pingStore, type PingInput } from './ping-store.js';

const ping = (from: string, at: number, x = 1): PingInput => ({
  from,
  sceneId: 'SCENE',
  at,
  point: { x, y: 0, z: 1 },
});

beforeEach(() => {
  pingStore.getState().clear();
});

describe('ping markers (LAY-05)', () => {
  it('keeps markers in arrival order with distinct keys', () => {
    const store = pingStore;
    store.getState().add(ping('alice', 1_000));
    store.getState().add(ping('bob', 1_001));
    const markers: readonly PingMarker[] = store.getState().markers;
    expect(markers.map((marker) => marker.from)).toEqual(['alice', 'bob']);
    expect(markers.map((marker) => marker.key)).toEqual([...new Set(markers.map((m) => m.key))]);
    expect(markers[0]?.point).toEqual({ x: 1, y: 0, z: 1 });
  });

  it('drops only the markers whose life has ended, and keeps the array identity otherwise', () => {
    const store = pingStore;
    store.getState().add(ping('alice', 1_000));
    store.getState().add(ping('bob', 1_000 + PING_TTL_MS));
    store.getState().prune(1_000 + PING_TTL_MS - 1);
    expect(store.getState().markers).toHaveLength(2);
    const before = store.getState().markers;
    store.getState().prune(1_000 + PING_TTL_MS - 1);
    expect(store.getState().markers).toBe(before);
    store.getState().prune(1_000 + PING_TTL_MS);
    expect(store.getState().markers.map((marker) => marker.from)).toEqual(['bob']);
    store.getState().prune(9_000);
    expect(store.getState().markers).toEqual([]);
  });

  it('caps a burst at the newest markers so a flood cannot grow the list without bound', () => {
    const store = pingStore;
    for (let index = 0; index < MAX_ACTIVE_PINGS + 5; index += 1) {
      store.getState().add(ping('spammer', 1_000, index));
    }
    const markers = store.getState().markers;
    expect(markers).toHaveLength(MAX_ACTIVE_PINGS);
    expect(markers.at(-1)?.point.x).toBe(MAX_ACTIVE_PINGS + 4);
    expect(markers[0]?.point.x).toBe(5);
  });

  it('counts centre requests for the board button without touching the markers', () => {
    const store = pingStore;
    store.getState().add(ping('alice', 1_000));
    const markers = store.getState().markers;
    store.getState().requestCentre();
    store.getState().requestCentre();
    expect(store.getState().centreRequests).toBe(2);
    expect(store.getState().markers).toBe(markers);
  });
});
