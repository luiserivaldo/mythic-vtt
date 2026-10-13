import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DRAW_COLOR,
  DEFAULT_DRAW_WIDTH,
  DRAW_CLEAR_CHANNEL,
  DRAW_ERASE_CHANNEL,
  DRAW_STROKE_CHANNEL,
} from '@mythic/shared';
import { audienceFor } from './audience.js';
import { createEphemeralRelay, type EphemeralRecipient } from './ephemeral-relay.js';
import { T, fakeConnection, fixtureCampaign, tid, type FakeConnection } from './testing.js';

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

describe('drawing relay (LAY-05)', () => {
  const STROKE = tid(20);
  const OTHER_STROKE = tid(21);

  function strokeMessage(strokeId: string, over: Record<string, unknown> = {}) {
    return {
      t: 'ephemeral' as const,
      channel: DRAW_STROKE_CHANNEL,
      data: {
        sceneId: T.scene,
        strokeId,
        color: DEFAULT_DRAW_COLOR,
        width: DEFAULT_DRAW_WIDTH,
        phase: 'finished',
        points: [
          { x: 1, y: 0, z: 1 },
          { x: 2, y: 0, z: 1 },
        ],
        ...over,
      },
    };
  }

  it('gates live drawing on the scene toggle, with the host and co-DM exempt', () => {
    const state = fixtureCampaign();
    const coDmSeat = state.seats[T.coDm];
    if (!coDmSeat) throw new Error('fixture incomplete');
    coDmSeat.identityId = T.carol;
    const alice = fakeConnection(T.alice);
    const host = fakeConnection(T.host, { isHost: true });
    const coDm = fakeConnection(T.carol);
    const watcher = fakeConnection(T.host, { isHost: true });
    const targets = recipients(state, [watcher]);
    const relay = createEphemeralRelay(() => 1_000);

    relay.relay(alice, strokeMessage(STROKE), state, targets);
    expect(watcher.received).toEqual([]);
    expect(relay.stats().dropped.forbidden).toBe(1);

    relay.relay(host, strokeMessage(STROKE), state, targets);
    relay.relay(coDm, strokeMessage(OTHER_STROKE), state, targets);
    expect(watcher.received).toHaveLength(2);
    expect(watcher.received.at(-1)).toMatchObject({
      t: 'ephemeral',
      channel: DRAW_STROKE_CHANNEL,
      from: T.carol,
      data: { strokeId: OTHER_STROKE, color: DEFAULT_DRAW_COLOR },
    });

    const scene = state.scenes[T.scene];
    if (!scene) throw new Error('fixture incomplete');
    scene.playerToggles = { draw: true };
    relay.relay(alice, strokeMessage(tid(22)), state, targets);
    expect(watcher.received).toHaveLength(3);
    expect(watcher.received.at(-1)).toMatchObject({ from: T.alice });
  });

  it('drops a malformed stroke as invalid-drawing and never relays it', () => {
    const state = fixtureCampaign();
    const scene = state.scenes[T.scene];
    if (!scene) throw new Error('fixture incomplete');
    scene.playerToggles = { draw: true };
    const alice = fakeConnection(T.alice);
    const host = fakeConnection(T.host, { isHost: true });
    const watcher = fakeConnection(T.host, { isHost: true });
    const targets = recipients(state, [watcher]);
    const relay = createEphemeralRelay(() => 1_000);

    for (const bad of [
      strokeMessage(STROKE, { width: DEFAULT_DRAW_WIDTH * 100 }),
      strokeMessage(STROKE, { width: Number.NaN }),
      strokeMessage(STROKE, { points: [] }),
      strokeMessage(STROKE, { points: [{ x: Number.NaN, y: 0, z: 0 }] }),
      strokeMessage(STROKE, { color: 'red' }),
      strokeMessage(STROKE, { phase: 'cancelled' }),
      strokeMessage(STROKE, { strokeId: 'not-a-ulid' }),
      strokeMessage(STROKE, { extra: 1 }),
    ]) {
      relay.relay(alice, bad, state, targets);
      relay.relay(host, bad, state, targets);
    }
    // The host is exempt from the scene toggle, but an unknown scene is refused by the gate itself.
    relay.relay(host, strokeMessage(STROKE, { sceneId: T.newScene }), state, targets);
    expect(watcher.received).toEqual([]);
    expect(relay.stats().dropped).toMatchObject({ 'invalid-drawing': 16, forbidden: 1 });
  });

  it('lets an author erase their own drawing, and the DM or a co-DM erase any', () => {
    const state = fixtureCampaign();
    const scene = state.scenes[T.scene];
    const coDmSeat = state.seats[T.coDm];
    const seatB = state.seats[T.seatB];
    if (!scene || !coDmSeat || !seatB) throw new Error('fixture incomplete');
    coDmSeat.identityId = T.carol;
    seatB.identityId = T.bob;
    scene.playerToggles = { draw: true };
    const alice = fakeConnection(T.alice);
    const bob = fakeConnection(T.bob);
    const host = fakeConnection(T.host, { isHost: true });
    const coDm = fakeConnection(T.carol);
    const watcher = fakeConnection(T.host, { isHost: true });
    const targets = recipients(state, [watcher]);
    const relay = createEphemeralRelay(() => 1_000);
    const erase = (strokeId: string) => ({
      t: 'ephemeral' as const,
      channel: DRAW_ERASE_CHANNEL,
      data: { sceneId: T.scene, strokeId },
    });

    relay.relay(alice, strokeMessage(STROKE), state, targets);
    relay.relay(bob, strokeMessage(OTHER_STROKE), state, targets);
    expect(watcher.received).toHaveLength(2);

    // Bob may not erase Alice's drawing, and an unknown stroke is nobody's to erase.
    relay.relay(bob, erase(STROKE), state, targets);
    relay.relay(alice, erase(tid(22)), state, targets);
    expect(watcher.received).toHaveLength(2);
    expect(relay.stats().dropped).toMatchObject({ forbidden: 1, 'invalid-drawing': 1 });

    relay.relay(alice, erase(STROKE), state, targets);
    expect(watcher.received).toHaveLength(3);
    expect(watcher.received.at(-1)).toMatchObject({
      t: 'ephemeral',
      channel: DRAW_ERASE_CHANNEL,
      from: T.alice,
      data: { strokeId: STROKE },
    });
    // The erased stroke is gone: erasing it again finds nothing.
    relay.relay(alice, erase(STROKE), state, targets);
    expect(relay.stats().dropped['invalid-drawing']).toBe(2);

    relay.relay(coDm, erase(OTHER_STROKE), state, targets);
    expect(watcher.received).toHaveLength(4);
    expect(watcher.received.at(-1)).toMatchObject({ from: T.carol });
    // The host may erase any drawing, but a stroke that is not there is not a drawing.
    relay.relay(host, erase(tid(23)), state, targets);
    expect(watcher.received).toHaveLength(4);
    expect(relay.stats().dropped['invalid-drawing']).toBe(3);
  });

  it('lets only the DM and co-DMs clear every drawing on the scene', () => {
    const state = fixtureCampaign();
    const scene = state.scenes[T.scene];
    const coDmSeat = state.seats[T.coDm];
    if (!scene || !coDmSeat) throw new Error('fixture incomplete');
    coDmSeat.identityId = T.carol;
    scene.playerToggles = { draw: true };
    const alice = fakeConnection(T.alice);
    const host = fakeConnection(T.host, { isHost: true });
    const coDm = fakeConnection(T.carol);
    const watcher = fakeConnection(T.host, { isHost: true });
    const targets = recipients(state, [watcher]);
    const relay = createEphemeralRelay(() => 1_000);
    const clear = (sceneId: string) => ({
      t: 'ephemeral' as const,
      channel: DRAW_CLEAR_CHANNEL,
      data: { sceneId },
    });

    relay.relay(alice, strokeMessage(STROKE), state, targets);
    // A player may not clear, and the refusal does not reveal whether the scene exists.
    relay.relay(alice, clear(T.scene), state, targets);
    relay.relay(alice, clear(T.newScene), state, targets);
    expect(watcher.received).toHaveLength(1);
    expect(relay.stats().dropped.forbidden).toBe(2);

    relay.relay(coDm, clear(T.scene), state, targets);
    expect(watcher.received).toHaveLength(2);
    expect(watcher.received.at(-1)).toMatchObject({
      t: 'ephemeral',
      channel: DRAW_CLEAR_CHANNEL,
      from: T.carol,
      data: { sceneId: T.scene },
    });
    // Cleared: Alice's stroke is gone, so erasing it finds nothing.
    relay.relay(
      alice,
      { t: 'ephemeral', channel: DRAW_ERASE_CHANNEL, data: { sceneId: T.scene, strokeId: STROKE } },
      state,
      targets,
    );
    expect(relay.stats().dropped['invalid-drawing']).toBe(1);
    relay.relay(host, clear(T.scene), state, targets);
    expect(watcher.received).toHaveLength(3);
    expect(watcher.received.at(-1)).toMatchObject({ from: T.host });
  });

  it('relays drawings to spectators too: effects are visible to everyone (LAY-05)', () => {
    const state = fixtureCampaign();
    const scene = state.scenes[T.scene];
    if (!scene) throw new Error('fixture incomplete');
    scene.playerToggles = { draw: true };
    const alice = fakeConnection(T.alice);
    const spectator = fakeConnection(T.bob);
    const relay = createEphemeralRelay(() => 1_000, {
      spectatorDeliveryRate: { ratePerSecond: 100, burst: 100 },
    });
    relay.relay(alice, strokeMessage(STROKE), state, recipients(state, [spectator]));
    expect(spectator.received).toHaveLength(1);
    expect(spectator.received[0]).toMatchObject({ t: 'ephemeral', from: T.alice });
  });

  it('never sends a drawing of a scene a target cannot see, and refuses to draw on one', () => {
    const state = fixtureCampaign();
    const scene = state.scenes[T.scene];
    const coDmSeat = state.seats[T.coDm];
    if (!scene || !coDmSeat) throw new Error('fixture incomplete');
    coDmSeat.identityId = T.carol;
    // A second, DM-only scene that is not the active one: a player knows nothing about it.
    state.scenes[T.newScene] = {
      ...scene,
      id: T.newScene,
      name: 'SECRET-SCENE',
      dmOnly: true,
      playerToggles: { draw: true },
    };
    state.activeSceneId = T.scene;

    const host = fakeConnection(T.host, { isHost: true });
    const coDm = fakeConnection(T.carol);
    const player = fakeConnection(T.alice);
    const watcher = fakeConnection(T.host, { isHost: true });
    const relay = createEphemeralRelay(() => 1_000);
    const secret = strokeMessage(STROKE, { sceneId: T.newScene });

    relay.relay(host, secret, state, recipients(state, [watcher, coDm, player]));
    expect(watcher.received).toHaveLength(1);
    expect(coDm.received).toHaveLength(1);
    expect(player.received).toEqual([]);
    expect(player.wire()).not.toContain(T.newScene);
    expect(player.wire()).not.toContain('SECRET-SCENE');

    // A player may not draw on a scene they cannot see, even with the toggle on for it.
    relay.relay(player, secret, state, recipients(state, [watcher]));
    expect(watcher.received).toHaveLength(1);
    expect(relay.stats().dropped.forbidden).toBe(1);
    expect(relay.stats().dropped['hidden-scene']).toBe(1);
    // A scene-hidden target is counted once: a drawing carries no entity of its own.
    expect(relay.stats().dropped['hidden-entity']).toBe(0);
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
