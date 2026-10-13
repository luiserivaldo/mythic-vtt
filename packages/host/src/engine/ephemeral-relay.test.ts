import { describe, expect, it } from 'vitest';
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

  it('relays a camera pose from the DM and a co-DM only (M4-11, CAM-06)', () => {
    const state = fixtureCampaign();
    const coDmSeat = state.seats[T.coDm];
    if (!coDmSeat) throw new Error('fixture incomplete');
    coDmSeat.identityId = T.carol;
    const host = fakeConnection(T.host, { isHost: true });
    const coDm = fakeConnection(T.carol);
    const alice = fakeConnection(T.alice);
    const watcher = fakeConnection(T.host, { isHost: true });
    const relay = createEphemeralRelay(() => 1_000);
    const pose = {
      t: 'ephemeral' as const,
      channel: 'camera.pose',
      data: { mode: '2d' as const, centerX: 4, centerZ: 6, zoom: 48, sceneId: T.scene, pull: true },
    };
    const send = (from: FakeConnection) => {
      relay.relay(from, pose, state, recipients(state, [watcher]));
    };

    // A player may not move anyone else's camera: the frame is dropped, not an error.
    send(alice);
    expect(watcher.received).toEqual([]);
    expect(relay.stats().dropped.forbidden).toBe(1);

    send(host);
    send(coDm);
    expect(watcher.received).toHaveLength(2);
    expect(watcher.received.at(-1)).toMatchObject({
      t: 'ephemeral',
      channel: 'camera.pose',
      from: T.carol,
      data: pose.data,
    });
    expect(relay.stats().dropped.forbidden).toBe(1);
  });

  it('never hands a camera pose to a target that cannot see its scene (M4-11 leak check)', () => {
    const state = fixtureCampaign();
    const scene = state.scenes[T.scene];
    const coDmSeat = state.seats[T.coDm];
    if (!scene || !coDmSeat) throw new Error('fixture incomplete');
    coDmSeat.identityId = T.carol;
    state.scenes[T.newScene] = { ...scene, id: T.newScene, name: 'DM notes', dmOnly: true };
    const host = fakeConnection(T.host, { isHost: true });
    const coDm = fakeConnection(T.carol);
    const alice = fakeConnection(T.alice);
    const spectator = fakeConnection(T.bob);
    const targets = recipients(state, [host, coDm, alice, spectator]);
    const relay = createEphemeralRelay(() => 1_000);
    const pose = (sceneId: string) => ({
      t: 'ephemeral' as const,
      channel: 'camera.pose',
      data: { mode: '2d' as const, centerX: 1, centerZ: 2, zoom: 48, sceneId, pull: true },
    });

    // The DM's camera in a DM-only scene is the host's and a co-DM's business only.
    relay.relay(host, pose(T.newScene), state, targets);
    expect(host.received).toHaveLength(1);
    expect(coDm.received).toHaveLength(1);
    expect(alice.received).toEqual([]);
    expect(spectator.received).toEqual([]);
    expect(relay.stats()).toMatchObject({ relayed: 2, dropped: { 'hidden-scene': 2 } });

    // The active scene belongs to everyone, so the same pull reaches the player and the spectator.
    relay.relay(host, pose(T.scene), state, targets);
    expect(alice.received).toHaveLength(1);
    expect(spectator.received).toHaveLength(1);

    // Once the DM moves to the hidden scene, the old scene is out of the player's view as well.
    state.activeSceneId = T.newScene;
    relay.relay(host, pose(T.scene), state, targets);
    expect(alice.received).toHaveLength(1);
    expect(spectator.received).toHaveLength(1);
    expect(relay.stats().dropped['hidden-scene']).toBe(4);

    // A pose that names no scene at all is malformed, and moves nobody.
    relay.relay(
      host,
      { t: 'ephemeral', channel: 'camera.pose', data: { mode: '2d', centerX: 1, centerZ: 2 } },
      state,
      targets,
    );
    expect(relay.stats().dropped['invalid-scene-reference']).toBe(1);
    expect(alice.received).toHaveLength(1);
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
    relay.relay(spectator, { t: 'ephemeral', channel: 'ping', data: { x: 1 } }, state, targets);
    relay.relay(spectator, { t: 'ephemeral', channel: 'ping', data: { x: 2 } }, state, targets);

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

it('shares the validated profile colour for rulers and cursors instead of a spoofed preview colour', () => {
  const state = fixtureCampaign();
  const alice = { ...fakeConnection(T.alice), color: '#ab1234' };
  const host = fakeConnection(T.host, { isHost: true });
  const relay = createEphemeralRelay(() => 1000);
  for (const channel of ['ruler.preview', 'cursor']) {
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
