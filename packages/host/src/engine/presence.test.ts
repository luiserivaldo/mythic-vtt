import { describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@mythic/protocol';
import { createEngine } from './engine.js';
import { buildHostPresence } from './presence.js';
import {
  T,
  fakeClock,
  fakeConnection,
  fakeRandom,
  fixtureCampaign,
  memoryLog,
  tid,
  type FakeConnection,
} from './testing.js';

const named = (id: string, name: string, opts: { isHost?: boolean } = {}): FakeConnection =>
  Object.assign(fakeConnection(id, opts), { displayName: name });

const presenceOf = (c: FakeConnection) =>
  c.received.filter((m): m is Extract<ServerMessage, { t: 'presence' }> => m.t === 'presence');
const noticesOf = (c: FakeConnection) =>
  c.received.filter((m): m is Extract<ServerMessage, { t: 'notice' }> => m.t === 'notice');

function setup(joinUrls?: readonly { kind: 'lan' | 'public'; url: string }[]) {
  return createEngine({
    campaign: fixtureCampaign(),
    sessionId: tid(20),
    store: memoryLog(),
    clock: fakeClock(),
    random: fakeRandom(),
    onError: () => undefined,
    ...(joinUrls !== undefined ? { hostJoinUrls: () => joinUrls } : {}),
  });
}

describe('buildHostPresence', () => {
  it('lists unseated, non-host identities once and marks seats online', () => {
    const p = buildHostPresence(fixtureCampaign(), [
      named(T.alice, 'Alice'),
      named(T.bob, 'Bob'),
      named(T.bob, 'Bob again'),
      named(T.host, 'DM', { isHost: true }),
    ]);
    expect(p.unseated).toEqual([{ identityId: T.bob, displayName: 'Bob' }]);
    expect(p.spectators).toBe(1);
    expect(p.seats.find((s) => s.seatId === T.seatA)).toEqual({
      seatId: T.seatA,
      displayName: 'Alice',
      connected: true,
      latencyMs: null,
    });
    expect(p.seats.find((s) => s.seatId === T.seatB)?.connected).toBe(false);
  });
});

describe('engine roster (M1-11, PERM-03)', () => {
  it('sends the roster to the host only and never leaks identity ids to others', async () => {
    const engine = setup();
    const host = named(T.host, 'DM', { isHost: true });
    const alice = named(T.alice, 'Alice');
    const bob = named(T.bob, 'Bobby');
    await engine.onConnect(host);
    await engine.onConnect(alice);
    await engine.onConnect(bob);
    await engine.idle();

    const last = presenceOf(host).at(-1);
    expect(last?.unseated).toEqual([{ identityId: T.bob, displayName: 'Bobby' }]);

    // Non-leak: seated players and unseated spectators receive no presence at all.
    expect(presenceOf(alice)).toEqual([]);
    expect(presenceOf(bob)).toEqual([]);
    expect(bob.wire()).not.toContain('Alice');
    expect(alice.wire()).not.toContain('Bobby');
  });

  it('sends reported join URLs to host connections only', async () => {
    const joinUrls = [{ kind: 'public' as const, url: 'https://table.example/play' }];
    const engine = setup(joinUrls);
    const host = named(T.host, 'DM', { isHost: true });
    const player = named(T.alice, 'Alice');
    const spectator = named(T.bob, 'Bob');
    await engine.onConnect(host);
    await engine.onConnect(player);
    await engine.onConnect(spectator);
    await engine.idle();

    expect(noticesOf(host)).toEqual([
      {
        t: 'notice',
        level: 'info',
        code: 'join-url-public',
        message: 'https://table.example/play',
      },
    ]);
    for (const connection of [player, spectator]) {
      expect(noticesOf(connection)).toEqual([]);
      expect(connection.wire()).not.toContain('table.example');
    }
  });

  it('updates when an identity is seated or disconnects', async () => {
    const engine = setup();
    const host = named(T.host, 'DM', { isHost: true });
    const bob = named(T.bob, 'Bobby');
    await engine.onConnect(host);
    await engine.onConnect(bob);
    await engine.onIntent(host, {
      t: 'intent',
      type: 'seat.assign',
      payload: { seatId: T.seatB, identityId: T.bob },
      clientRef: 'a1',
    });
    await engine.idle();
    expect(presenceOf(host).at(-1)?.unseated).toEqual([]);

    engine.onDisconnect(bob);
    expect(
      presenceOf(host)
        .at(-1)
        ?.seats.find((s) => s.seatId === T.seatB)?.connected,
    ).toBe(false);
  });
});

describe('presence latency (UX-06)', () => {
  it('reports a seat RTT and clears it when its identity goes offline', () => {
    const alice = Object.assign(named(T.alice, 'Alice'), { latencyMs: 42 });
    const state = fixtureCampaign();
    expect(
      buildHostPresence(state, [alice]).seats.find((seat) => seat.seatId === T.seatA),
    ).toMatchObject({ connected: true, latencyMs: 42 });
    expect(
      buildHostPresence(state, []).seats.find((seat) => seat.seatId === T.seatA),
    ).toMatchObject({ connected: false, latencyMs: null });
  });
  it('coalesces telemetry across seats, keeps the roster private, and publishes offline immediately', async () => {
    vi.useFakeTimers();
    try {
      const engine = setup();
      const host = named(T.host, 'DM', { isHost: true });
      const alice = Object.assign(named(T.alice, 'Alice'), { latencyMs: 10 });
      const observer = named(T.bob, 'Bob');
      await engine.onConnect(host);
      await engine.onConnect(alice);
      await engine.onConnect(observer);
      host.clear();
      alice.clear();
      observer.clear();
      for (let n = 0; n < 50; n++) {
        alice.latencyMs = n;
        engine.onLatency?.(alice);
      }
      await vi.advanceTimersByTimeAsync(999);
      expect(presenceOf(host)).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(presenceOf(host)).toHaveLength(1);
      expect(presenceOf(host)[0]?.seats.find((seat) => seat.seatId === T.seatA)?.latencyMs).toBe(
        49,
      );
      expect(presenceOf(alice)).toEqual([]);
      expect(presenceOf(observer)).toEqual([]);
      expect(alice.wire()).not.toContain(T.bob);
      engine.onLatency?.(alice);
      engine.onDisconnect(alice);
      expect(
        presenceOf(host)
          .at(-1)
          ?.seats.find((seat) => seat.seatId === T.seatA),
      ).toMatchObject({ connected: false, latencyMs: null });
      const count = presenceOf(host).length;
      await vi.advanceTimersByTimeAsync(1000);
      expect(presenceOf(host)).toHaveLength(count);
      engine.onLatency?.(alice);
      await vi.advanceTimersByTimeAsync(1000);
      expect(presenceOf(host)).toHaveLength(count);
    } finally {
      vi.useRealTimers();
    }
  });
});
