import { describe, expect, it } from 'vitest';
import {
  appendDrawPoint,
  DEFAULT_DRAW_COLOR,
  DEFAULT_DRAW_WIDTH,
  DRAW_CLEAR_CHANNEL,
  DRAW_COORD_LIMIT,
  DRAW_ERASE_CHANNEL,
  DRAW_STROKE_CHANNEL,
  MAX_DRAW_POINTS,
  MAX_STROKE_SAMPLES,
  PING_CHANNEL,
  PING_TOOL,
  resolveSeatTools,
  simplifyDrawPoints,
  type Campaign,
  type SeatTools,
} from '@mythic/shared';
import { audienceFor } from './audience.js';
import { createEphemeralRelay, type EphemeralRecipient } from './ephemeral-relay.js';
import { T, fakeConnection, fixtureCampaign, tid, type FakeConnection } from './testing.js';

/** UI-SEAT-02 (UX-46): override board tools on every seat, as the DM does per seat. */
function grantTools(state: Campaign, tools: Partial<SeatTools>): void {
  for (const seat of Object.values(state.seats))
    seat.tools = { ...resolveSeatTools(seat), ...tools };
}

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

    grantTools(state, { measure: false });
    send(alice);
    expect(watcher.received).toHaveLength(0);
    expect(relay.stats().dropped.forbidden).toBe(1);
    send(host);
    send(coDm);
    expect(watcher.received).toHaveLength(2);

    grantTools(state, { measure: true });
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

  it('gives the camera pose its own spectator budget, so a ruler still reaches a spectator (M4-11)', () => {
    // One frozen tick: nothing replenishes, so every bucket only spends its burst. The shared
    // spectator fan-out defaults to burst 10 — exactly what a pose stream at 10/s spends — so the
    // continuous stream must not spend from it, or a player's ruler preview is dropped mid-pan.
    const state = fixtureCampaign();
    const host = fakeConnection(T.host, { isHost: true });
    const alice = fakeConnection(T.alice);
    const spectator = fakeConnection(T.bob);
    const targets = recipients(state, [host, alice, spectator]);
    const relay = createEphemeralRelay(() => 1_000);
    const stream = () => {
      relay.relay(
        host,
        {
          t: 'ephemeral',
          channel: 'camera.pose',
          data: { mode: '2d', centerX: 1, centerZ: 2, zoom: 48, sceneId: T.scene, pull: false },
        },
        state,
        targets,
      );
    };
    const poses = () =>
      spectator.received.filter((m) => m.t === 'ephemeral' && m.channel === 'camera.pose').length;

    for (let i = 0; i < 10; i++) stream();
    expect(poses()).toBe(10);
    expect(relay.stats().dropped['spectator-rate-limited']).toBe(0);

    relay.relay(
      alice,
      {
        t: 'ephemeral',
        channel: 'ruler.preview',
        data: { sceneId: T.scene, points: [{ x: 0, y: 0, z: 0 }], phase: 'active' },
      },
      state,
      targets,
    );
    // The ruler preview reaches the spectator during the pose stream, with nothing rate-limited.
    expect(spectator.received.at(-1)).toMatchObject({
      t: 'ephemeral',
      channel: 'ruler.preview',
      from: T.alice,
    });
    expect(relay.stats().dropped['spectator-rate-limited']).toBe(0);
  });

  it('rate-limits the pose stream on its own budget, never on the shared one (M4-11)', () => {
    // Both budgets are pinned to a different size, so each assertion says which one was spent.
    const state = fixtureCampaign();
    const host = fakeConnection(T.host, { isHost: true });
    const alice = fakeConnection(T.alice);
    const spectator = fakeConnection(T.bob);
    const targets = recipients(state, [host, alice, spectator]);
    const relay = createEphemeralRelay(() => 1_000, {
      cameraPoseDeliveryRate: { ratePerSecond: 1, burst: 4 },
      spectatorDeliveryRate: { ratePerSecond: 1, burst: 1 },
    });
    const stream = () => {
      relay.relay(
        host,
        {
          t: 'ephemeral',
          channel: 'camera.pose',
          data: { mode: '2d', centerX: 1, centerZ: 2, zoom: 48, sceneId: T.scene, pull: false },
        },
        state,
        targets,
      );
    };
    const poses = () =>
      spectator.received.filter((m) => m.t === 'ephemeral' && m.channel === 'camera.pose').length;

    for (let i = 0; i < 6; i++) stream();
    // Four poses are the pose budget's whole burst; the stream is still rate-limited, on its own
    // bucket, so the shared spectator budget keeps its single token for the ruler below.
    expect(poses()).toBe(4);
    expect(relay.stats().dropped['spectator-rate-limited']).toBe(2);

    relay.relay(
      alice,
      {
        t: 'ephemeral',
        channel: 'ruler.preview',
        data: { sceneId: T.scene, points: [{ x: 0, y: 0, z: 0 }], phase: 'active' },
      },
      state,
      targets,
    );
    expect(spectator.received.at(-1)).toMatchObject({ channel: 'ruler.preview' });
    expect(relay.stats().dropped['spectator-rate-limited']).toBe(2);
  });

  it('never fans out a malformed camera pose (M4-11, CAM-06)', () => {
    const state = fixtureCampaign();
    const host = fakeConnection(T.host, { isHost: true });
    const spectator = fakeConnection(T.bob);
    const targets = recipients(state, [spectator]);
    const relay = createEphemeralRelay(() => 1_000);
    for (const data of [
      // A zoom and a distance no camera can adopt, a non-finite centre, and a 3D pose with no
      // distance at all: the host parses a pose exactly as a receiving client does.
      { mode: '2d', centerX: 1, centerZ: 2, zoom: 0, sceneId: T.scene },
      { mode: '2d', centerX: Number.NaN, centerZ: 2, zoom: 48, sceneId: T.scene },
      { mode: '3d', targetX: 1, targetY: 0, targetZ: 1, azimuth: 0, polar: 0.9, sceneId: T.scene },
    ]) {
      relay.relay(host, { t: 'ephemeral', channel: 'camera.pose', data }, state, targets);
    }
    expect(spectator.received).toEqual([]);
    expect(relay.stats().dropped['invalid-camera-pose']).toBe(3);
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
    const pose = (sceneId: string, pull = true) => ({
      t: 'ephemeral' as const,
      channel: 'camera.pose',
      data: { mode: '2d' as const, centerX: 1, centerZ: 2, zoom: 48, sceneId, pull },
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

    // CAM-06: an ordinary pose is the DM's own camera moving, not an instruction to anyone. Only a
    // spectator that chose to follow uses it, so a player is never handed where the DM is looking —
    // and neither are the DM's own co-DM peers, whose cameras this frame cannot move.
    relay.relay(host, pose(T.scene, false), state, targets);
    expect(host.received).toHaveLength(2);
    expect(coDm.received).toHaveLength(2);
    expect(alice.received).toHaveLength(1);
    expect(spectator.received).toHaveLength(2);
    expect(relay.stats().dropped['audience-filtered']).toBe(3);

    // A pull is the DM's explicit "everyone, look here", and it is addressed to every viewer.
    relay.relay(host, pose(T.scene), state, targets);
    expect(alice.received).toHaveLength(2);
    expect(spectator.received).toHaveLength(3);

    // Once the DM moves to the hidden scene, the old scene is out of the player's view as well.
    // PERM-03's filter is memoised per state object (`visible-to.ts`), exactly as the snapshot path
    // uses it, so a scene switch is a new state — which is what an action produces.
    const switched = { ...state, activeSceneId: T.newScene };
    relay.relay(host, pose(T.scene), switched, targets);
    expect(alice.received).toHaveLength(2);
    expect(spectator.received).toHaveLength(3);
    expect(relay.stats().dropped['hidden-scene']).toBe(4);

    // A pose that names no scene at all is malformed, and moves nobody.
    relay.relay(
      host,
      { t: 'ephemeral', channel: 'camera.pose', data: { mode: '2d', centerX: 1, centerZ: 2 } },
      state,
      targets,
    );
    expect(relay.stats().dropped['invalid-camera-pose']).toBe(1);
    expect(alice.received).toHaveLength(2);
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

    // `pins` is opt-in by default (Player template), so a player's ping never leaves the host.
    expect(PING_TOOL).toBe('pins');
    send(alice);
    expect(watcher.received).toHaveLength(0);
    expect(relay.stats().dropped.forbidden).toBe(1);

    grantTools(state, { pins: true });
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
    };
    grantTools(state, { pins: true });

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

  it('filters a ping on an inactive scene per recipient: players and spectators learn nothing, the DM and co-DM do', () => {
    const state = fixtureCampaign();
    const coDmSeat = state.seats[T.coDm];
    const active = state.scenes[T.scene];
    if (!coDmSeat || !active) throw new Error('fixture incomplete');
    coDmSeat.identityId = T.carol;
    // The other half of the review's "dmOnly or inactive prep scene": a scene the DM is preparing but
    // has not activated is equally absent for players and spectators (UI-TOP-01), even with its `pins`
    // toggle open, so neither its id nor the pinged coordinates may be fanned out to them.
    state.scenes[T.newScene] = {
      ...active,
      id: T.newScene,
      name: 'Prepared',
    };
    grantTools(state, { pins: true });

    const host = fakeConnection(T.host, { isHost: true });
    const coDm = fakeConnection(T.carol);
    const alice = fakeConnection(T.alice);
    const spectator = fakeConnection(T.bob);
    const relay = createEphemeralRelay(() => 1_000);
    const ping = {
      t: 'ephemeral' as const,
      channel: PING_CHANNEL,
      data: { sceneId: T.newScene, x: 4.5, y: 0, z: 9.75 },
    };

    relay.relay(host, ping, state, recipients(state, [host, coDm, alice, spectator]));

    expect(host.received).toHaveLength(1);
    expect(coDm.received).toHaveLength(1);
    expect(alice.received).toEqual([]);
    expect(spectator.received).toEqual([]);
    expect(relay.stats()).toMatchObject({ relayed: 2, dropped: { 'hidden-scene': 2 } });
    const nonDmWire = alice.wire() + spectator.wire();
    expect(nonDmWire).not.toContain(T.newScene);
    expect(nonDmWire).not.toContain('9.75');

    // A co-DM sender is held to the same per-recipient rule — being exempt from the scene *toggle*
    // does not let a frame naming an unactivated scene reach the player or the spectator.
    alice.clear();
    spectator.clear();
    relay.relay(coDm, ping, state, recipients(state, [host, coDm, alice, spectator]));
    expect(host.received).toHaveLength(2);
    expect(coDm.received).toHaveLength(2);
    expect(alice.received).toEqual([]);
    expect(spectator.received).toEqual([]);
    expect(relay.stats()).toMatchObject({ relayed: 4, dropped: { 'hidden-scene': 4 } });
    expect(alice.wire() + spectator.wire()).not.toContain(T.newScene);
  });

  it('rate-limits a ping flood per connection before relaying it', () => {
    const state = fixtureCampaign();
    const scene = state.scenes[T.scene];
    if (!scene) throw new Error('fixture incomplete');
    grantTools(state, { pins: true });
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

  it('drops a malformed ping payload instead of fanning junk out on the gated channel', () => {
    const state = fixtureCampaign();
    const scene = state.scenes[T.scene];
    if (!scene) throw new Error('fixture incomplete');
    grantTools(state, { pins: true });
    const alice = { ...fakeConnection(T.alice), color: '#ab1234' };
    const watcher = fakeConnection(T.bob);
    const relay = createEphemeralRelay(() => 1_000);
    // Every case still names a scene the sender may use, so the toggle, scene and entity gates all
    // pass and only the payload shape can reject the frame.
    const malformed: unknown[] = [
      { sceneId: T.scene },
      { sceneId: T.scene, x: 1, y: 0 },
      { sceneId: T.scene, x: '1', y: 0, z: 0 },
      { sceneId: T.scene, x: Number.NaN, y: 0, z: 0 },
      { sceneId: T.scene, x: Number.POSITIVE_INFINITY, y: 0, z: 0 },
      { sceneId: T.scene, x: 1, y: 0, z: 1, color: 'red' },
      { sceneId: T.scene, x: 1, y: 0, z: 1, padding: 'x'.repeat(4096) },
    ];
    const send = (data: unknown) => {
      relay.relay(
        alice,
        { t: 'ephemeral', channel: PING_CHANNEL, data },
        state,
        recipients(state, [watcher]),
      );
    };
    for (const data of malformed) send(data);

    expect(watcher.received).toEqual([]);
    expect(relay.stats()).toMatchObject({
      relayed: 0,
      dropped: { 'invalid-payload': malformed.length },
    });

    // A well-formed ping is unaffected: it is relayed, with the sender's own profile colour.
    send({ sceneId: T.scene, x: 1, y: 0, z: 2, color: '#ffffff' });
    expect(watcher.received).toHaveLength(1);
    expect(watcher.received[0]).toMatchObject({
      t: 'ephemeral',
      channel: PING_CHANNEL,
      data: { sceneId: T.scene, x: 1, y: 0, z: 2, color: '#ab1234' },
    });
    expect(relay.stats().relayed).toBe(1);
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

  it('gates live drawing on the seat Draw tool, with the host and co-DM exempt', () => {
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
    grantTools(state, { draw: true });
    relay.relay(alice, strokeMessage(tid(22)), state, targets);
    expect(watcher.received).toHaveLength(3);
    expect(watcher.received.at(-1)).toMatchObject({ from: T.alice });
  });

  it('drops a malformed stroke as invalid-drawing and never relays it', () => {
    const state = fixtureCampaign();
    const scene = state.scenes[T.scene];
    if (!scene) throw new Error('fixture incomplete');
    grantTools(state, { draw: true });
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
    // The host is exempt from seat tools, but an unknown scene is refused by the gate itself.
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
    grantTools(state, { draw: true });
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
    grantTools(state, { draw: true });
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

  it('a refused erase changes nothing: the stroke stays erasable by the DM', () => {
    const state = fixtureCampaign();
    const scene = state.scenes[T.scene];
    if (!scene) throw new Error('fixture incomplete');
    grantTools(state, { draw: true });
    const alice = fakeConnection(T.alice);
    const host = fakeConnection(T.host, { isHost: true });
    const watcher = fakeConnection(T.host, { isHost: true });
    const targets = recipients(state, [watcher]);
    const relay = createEphemeralRelay(() => 1_000);
    const erase = {
      t: 'ephemeral' as const,
      channel: DRAW_ERASE_CHANNEL,
      data: { sceneId: T.scene, strokeId: STROKE },
    };

    relay.relay(alice, strokeMessage(STROKE), state, targets);
    expect(watcher.received).toHaveLength(1);

    // The DM moves the table to another scene: Alice may no longer see the one she drew on, so her
    // erase is refused there. A scene switch is a new state, as an action produces.
    const switched = {
      ...state,
      scenes: { ...state.scenes, [T.newScene]: { ...scene, id: T.newScene, name: 'Elsewhere' } },
      activeSceneId: T.newScene,
    };
    relay.relay(alice, erase, switched, targets);
    expect(watcher.received).toHaveLength(1);
    expect(relay.stats().dropped).toMatchObject({ forbidden: 1, 'invalid-drawing': 0 });

    // The refusal left the owner map alone, so the stroke is still on record and the DM erases it.
    relay.relay(host, erase, switched, targets);
    expect(watcher.received).toHaveLength(2);
    expect(watcher.received.at(-1)).toMatchObject({
      t: 'ephemeral',
      channel: DRAW_ERASE_CHANNEL,
      from: T.host,
      data: { strokeId: STROKE },
    });
    expect(relay.stats().dropped['invalid-drawing']).toBe(0);
  });

  it('a refused clear changes nothing: the scene keeps its remembered strokes', () => {
    const state = fixtureCampaign();
    const scene = state.scenes[T.scene];
    if (!scene) throw new Error('fixture incomplete');
    state.scenes[T.newScene] = { ...scene, id: T.newScene, name: 'Annex' };
    const host = fakeConnection(T.host, { isHost: true });
    const watcher = fakeConnection(T.host, { isHost: true });
    const targets = recipients(state, [watcher]);
    const relay = createEphemeralRelay(() => 1_000);

    relay.relay(host, strokeMessage(STROKE, { sceneId: T.newScene }), state, targets);
    expect(watcher.received).toHaveLength(1);

    // The scene is gone from the campaign, so it exists for nobody, not even the DM: a clear naming
    // it is refused, and the refusal must not forget the strokes the relay remembers for it.
    const without = {
      ...state,
      scenes: Object.fromEntries(Object.entries(state.scenes).filter(([id]) => id !== T.newScene)),
    };
    relay.relay(
      host,
      { t: 'ephemeral', channel: DRAW_CLEAR_CHANNEL, data: { sceneId: T.newScene } },
      without,
      targets,
    );
    expect(watcher.received).toHaveLength(1);
    expect(relay.stats().dropped.forbidden).toBe(1);

    // With the scene back, the stroke is still on record: erasing it relays instead of finding
    // nothing.
    relay.relay(
      host,
      {
        t: 'ephemeral',
        channel: DRAW_ERASE_CHANNEL,
        data: { sceneId: T.newScene, strokeId: STROKE },
      },
      state,
      targets,
    );
    expect(watcher.received).toHaveLength(2);
    expect(relay.stats().dropped['invalid-drawing']).toBe(0);
  });

  it('a stroke dropped for size is not recorded, so its id stays free', () => {
    const state = fixtureCampaign();
    const host = fakeConnection(T.host, { isHost: true });
    const alice = fakeConnection(T.alice);
    const scene = state.scenes[T.scene];
    if (!scene) throw new Error('fixture incomplete');
    grantTools(state, { draw: true });
    const watcher = fakeConnection(T.host, { isHost: true });
    const targets = recipients(state, [watcher]);
    // A stroke frame above the smallest cap: it passes authorisation, then fails the size check.
    const tiny = createEphemeralRelay(() => 1_000, { maxPayloadBytes: 256 });
    const long = {
      points: Array.from({ length: 20 }, (_, i) => ({ x: i, y: 0, z: i * 2 })),
    };

    tiny.relay(host, strokeMessage(STROKE, long), state, targets);
    expect(watcher.received).toEqual([]);
    expect(tiny.stats().dropped['payload-too-large']).toBe(1);

    // Had the refused stroke been recorded as the host's, Alice's frame under the same id would be
    // refused as a takeover (forbidden); it only meets the same size cap.
    tiny.relay(alice, strokeMessage(STROKE, long), state, targets);
    expect(tiny.stats().dropped).toMatchObject({ forbidden: 0, 'payload-too-large': 2 });
  });

  it('relays drawings to spectators too: effects are visible to everyone (LAY-05)', () => {
    const state = fixtureCampaign();
    const scene = state.scenes[T.scene];
    if (!scene) throw new Error('fixture incomplete');
    grantTools(state, { draw: true });
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
    };
    grantTools(state, { draw: true });
    state.activeSceneId = T.scene;

    const host = fakeConnection(T.host, { isHost: true });
    const coDm = fakeConnection(T.carol);
    const player = fakeConnection(T.alice);
    // A seat-less identity is a spectator: the same `visibleTo` path as a player, made explicit.
    const spectator = fakeConnection(T.bob);
    const watcher = fakeConnection(T.host, { isHost: true });
    const relay = createEphemeralRelay(() => 1_000);
    const secret = strokeMessage(STROKE, { sceneId: T.newScene });

    relay.relay(host, secret, state, recipients(state, [watcher, coDm, player, spectator]));
    expect(watcher.received).toHaveLength(1);
    expect(coDm.received).toHaveLength(1);
    expect(player.received).toEqual([]);
    expect(player.wire()).not.toContain(T.newScene);
    expect(player.wire()).not.toContain('SECRET-SCENE');
    expect(spectator.received).toEqual([]);
    expect(spectator.wire()).not.toContain(T.newScene);

    // A player may not draw on a scene they cannot see, even with the toggle on for it.
    relay.relay(player, secret, state, recipients(state, [watcher]));
    expect(watcher.received).toHaveLength(1);
    expect(relay.stats().dropped.forbidden).toBe(1);
    // The host, the co-DM and a seat-less spectator all saw the count: only the co-DM could see it.
    expect(relay.stats().dropped['hidden-scene']).toBe(2);
    // A scene-hidden target is counted once: a drawing carries no entity of its own.
    expect(relay.stats().dropped['hidden-entity']).toBe(0);
    expect(spectator.received).toEqual([]);
    expect(spectator.wire()).not.toContain(T.newScene);
  });

  it('relays a full-length stroke instead of dropping it as an oversized frame', () => {
    const state = fixtureCampaign();
    const scene = state.scenes[T.scene];
    if (!scene) throw new Error('fixture incomplete');
    grantTools(state, { draw: true });
    const alice = fakeConnection(T.alice);
    const watcher = fakeConnection(T.host, { isHost: true });
    const relay = createEphemeralRelay(() => 1_000);

    // The worst stroke a client can produce: a raw gesture that spans the whole drawing domain,
    // corner to corner, put through the same quantise-and-simplify path `DrawTool` uses, at the
    // wire cap. If this frame does not fit the relay's 4096-byte default, ordinary strokes are
    // silently dropped again (MV-155).
    let gesture: readonly { x: number; y: number; z: number }[] = [];
    for (let index = 0; index < MAX_STROKE_SAMPLES * 2; index += 1)
      gesture = appendDrawPoint(gesture, {
        x: -DRAW_COORD_LIMIT + (index * (2 * DRAW_COORD_LIMIT)) / (MAX_STROKE_SAMPLES * 2),
        y: -DRAW_COORD_LIMIT,
        z: index % 2 === 0 ? -DRAW_COORD_LIMIT : DRAW_COORD_LIMIT,
      });
    expect(gesture).toHaveLength(MAX_STROKE_SAMPLES);
    const points = simplifyDrawPoints(gesture);
    expect(points).toHaveLength(MAX_DRAW_POINTS);

    relay.relay(alice, strokeMessage(STROKE, { points }), state, recipients(state, [watcher]));
    expect(relay.stats().dropped['payload-too-large']).toBe(0);
    expect(relay.stats().relayed).toBe(1);
    expect(watcher.received).toHaveLength(1);
    expect(watcher.received[0]).toMatchObject({ t: 'ephemeral', from: T.alice });
    expect(Buffer.byteLength(watcher.wire(), 'utf8')).toBeLessThan(4096);
  });

  it('never rate-drops a drawing’s closing frame for spectators (LAY-05)', () => {
    const state = fixtureCampaign();
    const scene = state.scenes[T.scene];
    if (!scene) throw new Error('fixture incomplete');
    grantTools(state, { draw: true });
    const alice = fakeConnection(T.alice);
    // An identity with no seat is a spectator audience (SES-11).
    const spectator = fakeConnection(T.bob);
    const targets = recipients(state, [spectator]);
    const relay = createEphemeralRelay(() => 1_000, {
      spectatorDeliveryRate: { ratePerSecond: 1, burst: 1 },
    });

    // The first live frame takes the only spectator delivery token.
    relay.relay(alice, strokeMessage(STROKE, { phase: 'active' }), state, targets);
    expect(spectator.received).toHaveLength(1);
    // The closing frame is what makes the stroke stick: it must never be the one dropped, because
    // a short stroke may have sent nothing else and the spectator would lose the drawing entirely.
    relay.relay(alice, strokeMessage(STROKE), state, targets);
    expect(spectator.received).toHaveLength(2);
    expect(relay.stats().dropped['spectator-rate-limited']).toBe(0);
    // Ordinary live frames are still coalesced for spectators.
    relay.relay(alice, strokeMessage(OTHER_STROKE, { phase: 'active' }), state, targets);
    expect(spectator.received).toHaveLength(2);
    expect(relay.stats().dropped['spectator-rate-limited']).toBe(1);
  });

  it('never relays a ruler preview of a scene a target cannot see (PERM-03)', () => {
    const state = fixtureCampaign();
    const scene = state.scenes[T.scene];
    const coDmSeat = state.seats[T.coDm];
    if (!scene || !coDmSeat) throw new Error('fixture incomplete');
    coDmSeat.identityId = T.carol;
    state.scenes[T.newScene] = {
      ...scene,
      id: T.newScene,
      name: 'SECRET-SCENE',
      dmOnly: true,
    };
    grantTools(state, { measure: true });
    state.activeSceneId = T.scene;
    const coDm = fakeConnection(T.carol);
    const player = fakeConnection(T.alice);
    const relay = createEphemeralRelay(() => 1_000);
    const ruler = {
      t: 'ephemeral' as const,
      channel: 'ruler.preview',
      data: {
        sceneId: T.newScene,
        points: [
          { x: 1, y: 0, z: 1 },
          { x: 2, y: 0, z: 1 },
        ],
        phase: 'active',
      },
    };

    // The co-DM is exempt from the measure toggle, so only the scene filter can refuse this: one
    // filter for every sceneId-bearing channel, drawings and rulers alike.
    relay.relay(coDm, ruler, state, recipients(state, [player]));
    expect(player.received).toEqual([]);
    expect(player.wire()).not.toContain(T.newScene);
    expect(relay.stats().dropped['hidden-scene']).toBe(1);
  });
});

it('shares the validated profile colour for rulers, cursors and pings instead of a spoofed preview colour', () => {
  const state = fixtureCampaign();
  const scene = state.scenes[T.scene];
  if (!scene) throw new Error('fixture incomplete');
  // LAY-05: a player may ping only when the DM gave their seat the pins tool.
  grantTools(state, { pins: true });
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
