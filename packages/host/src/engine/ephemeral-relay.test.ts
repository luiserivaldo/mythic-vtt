import { describe, expect, it } from 'vitest';
import { PING_CHANNEL, PING_TOGGLE } from '@mythic/shared';
import { audienceFor } from './audience.js';
import { createEphemeralRelay, type EphemeralRecipient } from './ephemeral-relay.js';
import { T, fakeConnection, fixtureCampaign, type FakeConnection } from './testing.js';

function recipients(
  state: ReturnType<typeof fixtureCampaign>,
  connections: FakeConnection[],
): EphemeralRecipient[] {
  return connections.map((conn) => ({ conn, audience: audienceFor(state, conn) }));
}

describe('ephemeral relay', () => {
  it('blocks all tool ephemerals from a disabled seat and resumes after re-enabling', () => {
    const state = fixtureCampaign();
    const seat = state.seats[T.seatA];
    if (!seat) throw new Error('missing seat');
    const alice = fakeConnection(T.alice);
    const host = fakeConnection(T.host, { isHost: true });
    const relay = createEphemeralRelay(() => 1000);
    seat.interactionEnabled = false;
    for (const channel of ['cursor', 'ping', 'ruler', 'token.drag-preview'])
      relay.relay(alice, { t: 'ephemeral', channel, data: {} }, state, recipients(state, [host]));
    expect(host.received).toEqual([]);
    expect(relay.stats().dropped.forbidden).toBe(4);
    seat.interactionEnabled = true;
    relay.relay(
      alice,
      { t: 'ephemeral', channel: 'cursor', data: {} },
      state,
      recipients(state, [host]),
    );
    expect(host.received).toHaveLength(1);
  });

  it('gates ruler previews on the scene measure toggle: players dropped, host and co-DM unaffected', () => {
    const state = fixtureCampaign();
    const scene = state.scenes[T.scene];
    const coDmSeat = state.seats[T.coDm];
    if (!scene || !coDmSeat) throw new Error('fixture incomplete');
    coDmSeat.identityId = T.carol;
    const host = fakeConnection(T.host, { isHost: true });
    const coDm = fakeConnection(T.carol);
    const alice = fakeConnection(T.alice);
    const watcher = fakeConnection(T.host, { isHost: true });
    const relay = createEphemeralRelay(() => 1_000);
    const ruler = {
      t: 'ephemeral' as const,
      channel: 'ruler.preview',
      data: { sceneId: T.scene, points: [{ x: 0, y: 0, z: 0 }], phase: 'active' },
    };
    const send = (from: FakeConnection) => {
      relay.relay(from, ruler, state, recipients(state, [watcher]));
    };

    scene.playerToggles = { measure: false };
    send(alice);
    expect(watcher.received).toHaveLength(0);
    expect(relay.stats().dropped.forbidden).toBe(1);
    send(host);
    send(coDm);
    expect(watcher.received).toHaveLength(2);

    scene.playerToggles = { measure: true };
    send(alice);
    expect(watcher.received).toHaveLength(3);
    const seat = state.seats[T.seatA];
    if (!seat) throw new Error('missing seat');
    seat.interactionEnabled = false; // both gates must allow
    send(alice);
    expect(watcher.received).toHaveLength(3);
  });

  it('gates pings on the scene pins toggle: players dropped, host and co-DM unaffected', () => {
    const state = fixtureCampaign();
    const scene = state.scenes[T.scene];
    const coDmSeat = state.seats[T.coDm];
    if (!scene || !coDmSeat) throw new Error('fixture incomplete');
    coDmSeat.identityId = T.carol;
    const host = fakeConnection(T.host, { isHost: true });
    const coDm = fakeConnection(T.carol);
    const alice = fakeConnection(T.alice);
    const watcher = fakeConnection(T.bob);
    const relay = createEphemeralRelay(() => 1_000);
    const ping = {
      t: 'ephemeral' as const,
      channel: PING_CHANNEL,
      data: { sceneId: T.scene, x: 2, y: 0, z: 3 },
    };
    const send = (from: FakeConnection) => {
      relay.relay(from, ping, state, recipients(state, [watcher]));
    };

    // `pins` is opt-in by default, so a player's ping never leaves the host.
    expect(PING_TOGGLE).toBe('pins');
    send(alice);
    expect(watcher.received).toHaveLength(0);
    expect(relay.stats().dropped.forbidden).toBe(1);

    scene.playerToggles = { pins: true };
    send(alice);
    send(host);
    send(coDm);
    expect(watcher.received).toHaveLength(3);
    expect(watcher.received.at(-1)).toMatchObject({
      t: 'ephemeral',
      channel: PING_CHANNEL,
      from: T.carol,
      data: { sceneId: T.scene, x: 2, y: 0, z: 3 },
    });

    // A ping naming a scene the host does not have (or one the sender cannot see) is denied too.
    relay.relay(
      alice,
      { ...ping, data: { ...ping.data, sceneId: T.newScene } },
      state,
      recipients(state, [watcher]),
    );
    expect(watcher.received).toHaveLength(3);
    expect(relay.stats().dropped.forbidden).toBe(2);

    // The seat-level Enable Interaction switch still applies on top of an open toggle.
    const seat = state.seats[T.seatA];
    if (!seat) throw new Error('missing seat');
    seat.interactionEnabled = false;
    send(alice);
    expect(watcher.received).toHaveLength(3);
    seat.interactionEnabled = true;
    send(alice);
    expect(watcher.received).toHaveLength(4);
  });

  it('filters a ping by scene visibility per recipient: a hidden scene id and its coordinates never leak', () => {
    const state = fixtureCampaign();
    const coDmSeat = state.seats[T.coDm];
    const active = state.scenes[T.scene];
    if (!coDmSeat || !active) throw new Error('fixture incomplete');
    coDmSeat.identityId = T.carol;
    // A DM-only prep scene the DM is browsing (UX-04): it does not exist for players or spectators,
    // even with its `pins` toggle open.
    state.scenes[T.newScene] = {
      ...active,
      id: T.newScene,
      name: 'Prep',
      dmOnly: true,
      playerToggles: { pins: true },
    };

    const host = fakeConnection(T.host, { isHost: true });
    const coDm = fakeConnection(T.carol);
    const alice = fakeConnection(T.alice);
    const spectator = fakeConnection(T.bob);
    const relay = createEphemeralRelay(() => 1_000);
    const ping = (sceneId: string) => ({
      t: 'ephemeral' as const,
      channel: PING_CHANNEL,
      data: { sceneId, x: 2.5, y: 0, z: 3.25 },
    });

    relay.relay(host, ping(T.newScene), state, recipients(state, [host, coDm, alice, spectator]));

    // The DM and co-DM see the DM-only scene and get the marker; players and spectators get
    // nothing at all — neither the hidden scene's id nor the pinged coordinates reach them.
    expect(host.received).toHaveLength(1);
    expect(coDm.received).toHaveLength(1);
    expect(alice.received).toEqual([]);
    expect(spectator.received).toEqual([]);
    expect(relay.stats()).toMatchObject({ relayed: 2, dropped: { 'hidden-scene': 2 } });
    const nonDmWire = alice.wire() + spectator.wire();
    expect(nonDmWire).not.toContain(T.newScene);
    expect(nonDmWire).not.toContain('3.25');

    // A player cannot originate a ping naming a scene they cannot see, even with the toggle open.
    relay.relay(alice, ping(T.newScene), state, recipients(state, [host]));
    expect(host.received).toHaveLength(1);
    expect(relay.stats().dropped.forbidden).toBe(1);
  });

  it('rate-limits a ping flood per connection before relaying it', () => {
    const state = fixtureCampaign();
    const scene = state.scenes[T.scene];
    if (!scene) throw new Error('fixture incomplete');
    scene.playerToggles = { pins: true };
    const alice = fakeConnection(T.alice);
    const watcher = fakeConnection(T.bob);
    // A frozen clock: the bucket never refills, so exactly `burst` pings get through.
    const relay = createEphemeralRelay(() => 1_000, { activeRate: { ratePerSecond: 1, burst: 2 } });
    const ping = {
      t: 'ephemeral' as const,
      channel: PING_CHANNEL,
      data: { sceneId: T.scene, x: 1, y: 0, z: 1 },
    };
    for (let index = 0; index < 5; index += 1) {
      relay.relay(alice, ping, state, recipients(state, [watcher]));
    }
    expect(relay.stats()).toMatchObject({ relayed: 2, dropped: { 'rate-limited': 3 } });
  });

  it('filters entity previews by current audience, including D32 co-DM visibility', () => {
    const state = fixtureCampaign();
    const coDmSeat = state.seats[T.coDm];
    const secret = state.scenes[T.scene]?.entities[T.secret];
    const token = state.scenes[T.scene]?.entities[T.token];
    if (!coDmSeat || !secret || !token) throw new Error('fixture incomplete');
    coDmSeat.identityId = T.carol;
    secret.token = { sizeCells: 1, heightCells: 1, labelVisibility: 'dm' };
    token.token = { sizeCells: 1, heightCells: 1, labelVisibility: 'all' };

    const host = fakeConnection(T.host, { isHost: true });
    const coDm = fakeConnection(T.carol);
    const alice = fakeConnection(T.alice);
    const spectator = fakeConnection(T.bob);
    const connections = [host, coDm, alice, spectator];
    const relay = createEphemeralRelay(() => 1_000, {
      activeRate: { ratePerSecond: 100, burst: 100 },
      spectatorDeliveryRate: { ratePerSecond: 100, burst: 100 },
    });

    relay.relay(
      host,
      {
        t: 'ephemeral',
        channel: 'token.drag-preview',
        data: {
          sceneId: T.scene,
          entityId: T.secret,
          to: { x: 1, y: 0, z: 1 },
        },
      },
      state,
      recipients(state, connections),
    );

    expect(host.received).toHaveLength(1);
    expect(coDm.received).toHaveLength(1);
    expect(alice.received).toEqual([]);
    expect(spectator.received).toEqual([]);
    expect(relay.stats()).toMatchObject({
      relayed: 2,
      dropped: { 'hidden-entity': 2 },
    });

    relay.relay(
      alice,
      {
        t: 'ephemeral',
        channel: 'token.drag-preview',
        data: {
          sceneId: T.scene,
          entityId: T.token,
          to: { x: 2, y: 0, z: 2 },
        },
      },
      state,
      recipients(state, connections),
    );
    for (const connection of connections) {
      expect(connection.received.at(-1)).toMatchObject({
        t: 'ephemeral',
        channel: 'token.drag-preview',
        from: T.alice,
      });
    }
  });

  it('counts size, permission and token-bucket drops without sending errors', () => {
    const now = 1_000;
    const state = fixtureCampaign();
    const alice = fakeConnection(T.alice);
    const spectator = fakeConnection(T.bob);
    const relay = createEphemeralRelay(() => now, {
      maxPayloadBytes: 256,
      activeRate: { ratePerSecond: 1, burst: 3 },
      spectatorRate: { ratePerSecond: 1, burst: 1 },
      spectatorDeliveryRate: { ratePerSecond: 1, burst: 1 },
    });
    const targets = recipients(state, [alice, spectator]);

    relay.relay(
      alice,
      { t: 'ephemeral', channel: 'cursor', data: { text: 'x'.repeat(300) } },
      state,
      targets,
    );
    relay.relay(
      alice,
      {
        t: 'ephemeral',
        channel: 'token.drag-preview',
        data: {
          sceneId: T.scene,
          entityId: T.secret,
          to: { x: 0, y: 0, z: 0 },
        },
      },
      state,
      targets,
    );
    relay.relay(spectator, { t: 'ephemeral', channel: 'cursor', data: { x: 1 } }, state, targets);
    relay.relay(spectator, { t: 'ephemeral', channel: 'cursor', data: { x: 2 } }, state, targets);

    expect(alice.received.filter((m) => m.t === 'error')).toEqual([]);
    expect(spectator.received.filter((m) => m.t === 'error')).toEqual([]);
    expect(relay.stats()).toMatchObject({
      relayed: 2,
      dropped: {
        'payload-too-large': 1,
        forbidden: 1,
        'rate-limited': 1,
      },
    });

    relay.relay(alice, { t: 'ephemeral', channel: 'cursor', data: { x: 3 } }, state, targets);
    expect(relay.stats().dropped['spectator-rate-limited']).toBe(1);
  });
});

it('shares the validated profile colour for rulers, cursors and pings instead of a spoofed preview colour', () => {
  const state = fixtureCampaign();
  const scene = state.scenes[T.scene];
  if (!scene) throw new Error('fixture incomplete');
  // LAY-05: a player may ping only where the DM opened the scene's pins toggle.
  scene.playerToggles = { pins: true };
  const alice = { ...fakeConnection(T.alice), color: '#ab1234' };
  const host = fakeConnection(T.host, { isHost: true });
  const relay = createEphemeralRelay(() => 1000);
  for (const channel of ['ruler.preview', 'cursor', PING_CHANNEL]) {
    const data =
      channel === 'ruler.preview'
        ? {
            sceneId: T.scene,
            points: [
              { x: 1, y: 0, z: 1 },
              { x: 2, y: 0, z: 1 },
            ],
            phase: 'active',
            color: '#ffffff',
          }
        : channel === PING_CHANNEL
          ? { sceneId: T.scene, x: 1, y: 0, z: 2, color: '#ffffff' }
          : { x: 1, color: '#ffffff' };
    relay.relay(alice, { t: 'ephemeral', channel, data }, state, recipients(state, [host]));
    expect(host.received.at(-1)).toMatchObject({
      t: 'ephemeral',
      channel,
      from: T.alice,
      data: { color: '#ab1234' },
    });
  }
});
