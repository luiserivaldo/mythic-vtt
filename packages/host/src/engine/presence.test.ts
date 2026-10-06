import { describe, expect, it } from 'vitest';
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

function setup() {
  return createEngine({
    campaign: fixtureCampaign(),
    sessionId: tid(20),
    store: memoryLog(),
    clock: fakeClock(),
    random: fakeRandom(),
    onError: () => undefined,
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
