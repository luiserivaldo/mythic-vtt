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
