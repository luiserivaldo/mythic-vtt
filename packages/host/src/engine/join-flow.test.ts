import { describe, expect, it } from 'vitest';
import type { ServerMessage } from '@mythic/protocol';
import { createEngine } from './engine.js';
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
const errorsOf = (c: FakeConnection) =>
  c.received.filter((m): m is Extract<ServerMessage, { t: 'error' }> => m.t === 'error');

function setup(campaign = fixtureCampaign()) {
  const log = memoryLog();
  const engine = createEngine({
    campaign,
    sessionId: tid(20),
    store: log,
    clock: fakeClock(),
    random: fakeRandom(),
    onError: () => undefined,
  });
  return { engine, log };
}

const temporarySeats = (engine: ReturnType<typeof setup>['engine']) =>
  Object.values(engine.state().seats).filter((seat) => seat.temporary);

describe('Join As Temporary Player (UI-JOIN-01)', () => {
  it('seats the joiner in a session-only seat named by their display name', async () => {
    const { engine } = setup();
    const host = named(T.host, 'DM', { isHost: true });
    const carol = named(T.carol, 'Carol');
    await engine.onConnect(host);
    await engine.onConnect(carol);
    await engine.onJoin(carol, { t: 'join', as: 'temporary', label: 'Visiting Bard' });
    await engine.idle();

    const [seat] = temporarySeats(engine);
    expect(seat).toMatchObject({
      label: 'Visiting Bard',
      identityId: T.carol,
      binding: 'session',
      role: 'player',
      temporary: true,
    });
    // The joiner is now on that seat's audience.
    const snapshot = carol.received.filter((m) => m.t === 'snapshot').at(-1);
    expect(snapshot).toMatchObject({ t: 'snapshot', seatId: seat?.id });
    // The host's roster no longer lists them as unseated.
    expect(presenceOf(host).at(-1)?.unseated).toEqual([]);
  });

  it('refuses a second temporary seat, a seated player and a table with no scene', async () => {
    const { engine } = setup();
    const carol = named(T.carol, 'Carol');
    const alice = named(T.alice, 'Alice');
    await engine.onConnect(carol);
    await engine.onConnect(alice);
    await engine.onJoin(carol, { t: 'join', as: 'temporary', label: 'One' });
    await engine.onJoin(carol, { t: 'join', as: 'temporary', label: 'Two' });
    await engine.onJoin(alice, { t: 'join', as: 'temporary', label: 'Alice again' });
    await engine.idle();
    expect(temporarySeats(engine).map((seat) => seat.label)).toEqual(['One']);
    expect(errorsOf(carol)).toHaveLength(1);
    expect(errorsOf(alice)).toHaveLength(1);

    const empty = fixtureCampaign();
    empty.activeSceneId = null;
    const closed = setup(empty);
    const bob = named(T.bob, 'Bob');
    await closed.engine.onConnect(bob);
    await closed.engine.onJoin(bob, { t: 'join', as: 'temporary', label: 'Early' });
    await closed.engine.idle();
    expect(temporarySeats(closed.engine)).toEqual([]);
  });

  it('lets the DM own a token for it, then drops seat and ownership at session end', async () => {
    const { engine } = setup();
    const host = named(T.host, 'DM', { isHost: true });
    const carol = named(T.carol, 'Carol');
    await engine.onConnect(host);
    await engine.onConnect(carol);
    await engine.onJoin(carol, { t: 'join', as: 'temporary', label: 'Visiting Bard' });
    await engine.idle();
    const seatId = temporarySeats(engine)[0]?.id ?? '';
    await engine.onIntent(host, {
      t: 'intent',
      type: 'entity.setOwners',
      payload: { sceneId: T.scene, entityId: T.token, owners: [seatId] },
      clientRef: 'own',
    });
    await engine.idle();
    expect(engine.state().scenes[T.scene]?.entities[T.token]?.owners).toEqual([seatId]);

    await engine.endSession();
    expect(temporarySeats(engine)).toEqual([]);
    expect(engine.state().scenes[T.scene]?.entities[T.token]?.owners).toEqual([]);
    // Permanent session-bound seats are untouched by this path.
    expect(engine.state().seats[T.seatA]?.identityId).toBe(T.alice);
  });

  it('does not show the temporary player identity to a spectator (PERM-03)', async () => {
    const { engine } = setup();
    const carol = named(T.carol, 'Carol');
    const bob = named(T.bob, 'Bob');
    await engine.onConnect(bob);
    await engine.onConnect(carol);
    await engine.onJoin(carol, { t: 'join', as: 'temporary', label: 'Visiting Bard' });
    await engine.idle();
    expect(bob.wire()).toContain('Visiting Bard');
    expect(bob.wire()).not.toContain(T.carol);
  });
});

describe('Join As Spectator (UI-JOIN-01, C10)', () => {
  it('is counted for the DM, never listed, and keeps no visual credentials', async () => {
    const { engine } = setup();
    const host = named(T.host, 'DM', { isHost: true });
    const bob = Object.assign(named(T.bob, 'Bobby-Visible'), {
      avatar: 'data:image/png;base64,AVATAR-BOB',
      color: '#123456',
    });
    const carol = named(T.carol, 'Carol');
    await engine.onConnect(host);
    await engine.onConnect(bob);
    await engine.onConnect(carol);
    expect(presenceOf(host).at(-1)?.spectators).toBe(0);
    expect(
      presenceOf(host)
        .at(-1)
        ?.unseated?.map((u) => u.identityId),
    ).toEqual([T.bob, T.carol]);

    await engine.onJoin(bob, { t: 'join', as: 'spectator' });
    await engine.idle();
    const last = presenceOf(host).at(-1);
    expect(last?.spectators).toBe(1);
    expect(last?.unseated?.map((u) => u.identityId)).toEqual([T.carol]);
    const wire = JSON.stringify(last);
    for (const secret of ['Bobby-Visible', 'AVATAR-BOB', '#123456', T.bob])
      expect(wire).not.toContain(secret);

    // Only the host ever receives presence.
    expect(presenceOf(bob)).toEqual([]);
    expect(presenceOf(carol)).toEqual([]);

    engine.onDisconnect(bob);
    expect(presenceOf(host).at(-1)?.spectators).toBe(0);
  });

  it('cannot relay tools, act, or be a spectator while seated or hosting', async () => {
    const { engine } = setup();
    const host = named(T.host, 'DM', { isHost: true });
    const alice = named(T.alice, 'Alice');
    const bob = named(T.bob, 'Bob');
    await engine.onConnect(host);
    await engine.onConnect(alice);
    await engine.onConnect(bob);
    await engine.onJoin(alice, { t: 'join', as: 'spectator' });
    await engine.onJoin(host, { t: 'join', as: 'spectator' });
    await engine.idle();
    expect(presenceOf(host).at(-1)?.spectators).toBe(0);

    host.clear();
    await engine.onEphemeral(bob, { t: 'ephemeral', channel: 'cursor', data: {} });
    await engine.idle();
    const before = host.received.filter((m) => m.t === 'ephemeral').length;
    expect(before).toBeGreaterThan(0);

    await engine.onJoin(bob, { t: 'join', as: 'spectator' });
    host.clear();
    await engine.onEphemeral(bob, { t: 'ephemeral', channel: 'cursor', data: {} });
    await engine.onIntent(bob, {
      t: 'intent',
      type: 'scene.rename',
      payload: { sceneId: T.scene, name: 'Hijack' },
      clientRef: 'x',
    });
    await engine.idle();
    expect(host.received.filter((m) => m.t === 'ephemeral')).toEqual([]);
    expect(engine.state().scenes[T.scene]?.name).toBe('Cave');
  });

  it('stops counting a spectator who then takes a seat', async () => {
    const { engine } = setup();
    const host = named(T.host, 'DM', { isHost: true });
    const bob = named(T.bob, 'Bob');
    await engine.onConnect(host);
    await engine.onConnect(bob);
    await engine.onJoin(bob, { t: 'join', as: 'spectator' });
    await engine.onJoin(bob, { t: 'join', seatId: T.seatB });
    await engine.idle();
    expect(engine.state().seats[T.seatB]?.identityId).toBe(T.bob);
    expect(presenceOf(host).at(-1)?.spectators).toBe(0);
  });
});

describe('Co-DM seats are host-granted (MV-269)', () => {
  const snapshotsOf = (c: FakeConnection) => c.received.filter((m) => m.t === 'snapshot');

  it('refuses a link visitor who claims a free co-DM seat, by join or by intent', async () => {
    for (const activeSceneId of [T.scene, null]) {
      const campaign = fixtureCampaign();
      campaign.activeSceneId = activeSceneId;
      const { engine, log } = setup(campaign);
      const bob = named(T.bob, 'Bob');
      await engine.onConnect(bob);
      await engine.onJoin(bob, { t: 'join', seatId: T.coDm });
      await engine.onIntent(bob, {
        t: 'intent',
        type: 'session.join',
        payload: { seatId: T.coDm, identityId: T.bob },
        clientRef: 'grab',
      });
      await engine.idle();
      expect(engine.state().seats[T.coDm]?.identityId).toBeNull();
      expect(errorsOf(bob)).toMatchObject([{ code: 'seat-unavailable' }]);
      expect(bob.received).toContainEqual({ t: 'reject', clientRef: 'grab', reason: 'forbidden' });
      expect(log.entries).toHaveLength(0);
      expect(snapshotsOf(bob).at(-1)).toMatchObject({ seatId: null });
    }
  });

  it('seats an identity the host assigned to the co-DM seat, and lets it rejoin', async () => {
    const { engine } = setup();
    const host = named(T.host, 'DM', { isHost: true });
    await engine.onConnect(host);
    await engine.onIntent(host, {
      t: 'intent',
      type: 'seat.assign',
      payload: { seatId: T.coDm, identityId: T.bob },
      clientRef: 'grant',
    });
    const bob = named(T.bob, 'Bob');
    await engine.onConnect(bob);
    await engine.onJoin(bob, { t: 'join', seatId: T.coDm });
    await engine.idle();
    expect(engine.state().seats[T.coDm]?.identityId).toBe(T.bob);
    expect(errorsOf(bob)).toEqual([]);
    expect(snapshotsOf(bob).at(-1)).toMatchObject({ seatId: T.coDm });
  });

  it('lets the holder rejoin its co-DM seat before a scene is active, with no notice (MV-270)', async () => {
    const campaign = fixtureCampaign();
    campaign.activeSceneId = null;
    const coDm = campaign.seats[T.coDm];
    if (coDm) coDm.identityId = T.bob;
    const { engine } = setup(campaign);
    const bob = named(T.bob, 'Bob');
    await engine.onConnect(bob);
    await engine.onJoin(bob, { t: 'join', seatId: T.coDm });
    await engine.idle();
    expect(engine.state().seats[T.coDm]?.identityId).toBe(T.bob);
    expect(errorsOf(bob)).toEqual([]);
    expect(bob.received.filter((m) => m.t === 'notice')).toEqual([]);
    expect(snapshotsOf(bob).at(-1)).toMatchObject({ seatId: T.coDm });

    // A visitor connecting to the same table is still told to wait, and still refused.
    const carol = named(T.carol, 'Carol');
    await engine.onConnect(carol);
    await engine.onJoin(carol, { t: 'join', seatId: T.coDm });
    await engine.idle();
    expect(carol.received).toContainEqual(
      expect.objectContaining({ t: 'notice', code: 'no-active-scene' }),
    );
    expect(errorsOf(carol)).toMatchObject([{ code: 'seat-unavailable' }]);
    expect(engine.state().seats[T.coDm]?.identityId).toBe(T.bob);
  });

  it('assigns a co-DM seat through a host-issued invite on the host authority', async () => {
    const campaign = fixtureCampaign();
    campaign.activeSceneId = null;
    const { engine, log } = setup(campaign);
    expect(await engine.claimSeat(T.bob, T.coDm)).toBe(true);
    expect(engine.state().seats[T.coDm]?.identityId).toBe(T.bob);
    expect(log.entries.at(-1)?.envelope).toMatchObject({
      type: 'seat.assign',
      actor: { kind: 'host' },
      payload: { seatId: T.coDm, identityId: T.bob },
    });
    // The invite still cannot take a seat someone else already holds.
    expect(await engine.claimSeat(T.carol, T.coDm)).toBe(false);
  });
});
