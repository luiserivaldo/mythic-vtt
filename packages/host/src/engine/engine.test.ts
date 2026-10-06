import { applyPatches, enablePatches, type Patch } from 'immer';
import { describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@mythic/protocol';
import { ActionEnvelope, visibleTo, type Audience, type Campaign } from '@mythic/shared';
import { createEngine, type EngineOptions } from './engine.js';
import {
  SECRETS,
  T,
  fakeClock,
  fakeConnection,
  fakeRandom,
  fixtureCampaign,
  memoryLog,
  tid,
  type FakeConnection,
} from './testing.js';

enablePatches();

type Of<K extends ServerMessage['t']> = Extract<ServerMessage, { t: K }>;
const SESSION = tid(20);

function setup(over: Partial<EngineOptions> = {}) {
  const log = memoryLog();
  const engine = createEngine({
    campaign: fixtureCampaign(),
    sessionId: SESSION,
    store: log,
    clock: fakeClock(),
    random: fakeRandom(),
    onError: () => undefined,
    ...over,
  });
  return { engine, log };
}

const intent = (type: string, payload: unknown, clientRef: string, sceneId?: string) => ({
  t: 'intent' as const,
  type,
  payload,
  clientRef,
  ...(sceneId !== undefined ? { sceneId } : {}),
});
const rename = (name: string, ref: string) =>
  intent('scene.rename', { sceneId: T.scene, name }, ref);

const ofType = <K extends ServerMessage['t']>(c: FakeConnection, t: K): Of<K>[] =>
  c.received.filter((m): m is Of<K> => m.t === t);

/** Rebuild the client's view from what it received, exactly like the client store does. */
function clientView(
  c: FakeConnection,
  before: readonly ServerMessage[] = [],
): { state: Campaign | null; seq: number | null } {
  let state: Campaign | null = null;
  let seq: number | null = null;
  for (const m of [...before, ...c.received]) {
    if (m.t === 'snapshot') {
      state = m.state as Campaign;
      seq = m.seq;
    } else if (m.t === 'patch') {
      if (state === null || seq === null) throw new Error('patch before snapshot');
      if (m.seq <= seq) continue;
      expect(m.seq).toBe(seq + 1); // strictly sequential, no gaps
      state = applyPatches(state, m.patches as Patch[]);
      seq = m.seq;
    }
  }
  return { state, seq };
}

function expectNoSecrets(...conns: FakeConnection[]) {
  for (const c of conns) for (const s of SECRETS) expect(c.wire()).not.toContain(s);
}

describe('connect', () => {
  it('sends each audience its own filtered snapshot (PERM-03)', async () => {
    const { engine } = setup();
    const host = fakeConnection(T.host, { isHost: true });
    const alice = fakeConnection(T.alice);
    const bob = fakeConnection(T.bob);
    for (const c of [host, alice, bob]) await engine.onConnect(c);

    expect(host.received).toEqual([
      { t: 'snapshot', seq: 0, state: fixtureCampaign(), seatId: null },
    ]);
    expect(ofType(alice, 'snapshot')[0]?.seatId).toBe(T.seatA);
    expect(ofType(bob, 'snapshot')[0]?.seatId).toBeNull();
    expect(host.wire()).toContain('SECRET-DM');
    expectNoSecrets(alice, bob);
    // The DM-layer entity is absent, not merely flagged.
    const aliceState = ofType(alice, 'snapshot')[0]?.state as Campaign;
    expect(aliceState.scenes[T.scene]?.entities[T.secret]).toBeUndefined();
    expect(aliceState.scenes[T.scene]?.entities[T.hiddenName]?.name).toBe('');
  });
});

describe('intent pipeline', () => {
  it('applies, logs, broadcasts per audience and acks the sender', async () => {
    const { engine, log } = setup();
    const host = fakeConnection(T.host, { isHost: true });
    const alice = fakeConnection(T.alice);
    const bob = fakeConnection(T.bob);
    for (const c of [host, alice, bob]) await engine.onConnect(c);
    for (const c of [host, alice, bob]) c.clear();

    await engine.onIntent(
      host,
      intent('scene.rename', { sceneId: T.scene, name: 'Lair' }, 'r1', T.scene),
    );

    expect(host.received).toEqual([
      {
        t: 'patch',
        seq: 1,
        clientRef: 'r1',
        patches: [{ op: 'replace', path: ['scenes', T.scene, 'name'], value: 'Lair' }],
      },
      { t: 'ack', clientRef: 'r1', seq: 1 },
    ]);
    for (const c of [alice, bob]) {
      expect(c.received).toEqual([
        {
          t: 'patch',
          seq: 1,
          patches: [{ op: 'replace', path: ['scenes', T.scene, 'name'], value: 'Lair' }],
        },
      ]);
    }
    expect(engine.seq()).toBe(1);
    expect(engine.state().scenes[T.scene]?.name).toBe('Lair');

    expect(log.entries).toHaveLength(1);
    const entry = log.entries[0];
    const envelope = ActionEnvelope.parse(entry?.envelope);
    expect(envelope).toMatchObject({
      type: 'scene.rename',
      actor: { kind: 'host', identityId: T.host },
      campaignId: T.campaign,
      sceneId: T.scene,
      sessionId: SESSION,
      seq: 1,
      ts: 1_700_000_000_000,
      clientRef: 'r1',
    });
    expect(envelope.rng).toBeUndefined();
    expect(entry?.inversePatches).toEqual([
      { op: 'replace', path: ['scenes', T.scene, 'name'], value: 'Cave' },
    ]);
  });

  it.each([
    ['unknown action', 'host', intent('nope.nope', {}, 'x'), 'unknown-action'],
    [
      'schema failure',
      'host',
      intent('scene.rename', { sceneId: T.scene }, 'x'),
      'invalid-payload',
    ],
    ['player without permission', 'alice', rename('Mine', 'x'), 'forbidden'],
    ['unseated identity', 'bob', rename('Mine', 'x'), 'forbidden'],
    [
      'unseated identity claiming a seat for someone else',
      'bob',
      intent('session.join', { seatId: T.seatB, identityId: T.carol }, 'x'),
      'forbidden',
    ],
  ] as const)('rejects %s without consuming a seq', async (_name, who, msg, reason) => {
    const { engine, log } = setup();
    const conns = {
      host: fakeConnection(T.host, { isHost: true }),
      alice: fakeConnection(T.alice),
      bob: fakeConnection(T.bob),
    };
    for (const c of Object.values(conns)) await engine.onConnect(c);
    for (const c of Object.values(conns)) c.clear();

    await engine.onIntent(conns[who], msg);

    expect(conns[who].received).toEqual([
      expect.objectContaining({ t: 'reject', clientRef: 'x', reason }),
    ]);
    // Zod messages echo input; the detail stays generic.
    expect(JSON.stringify(conns[who].received)).not.toContain('expected');
    for (const [name, c] of Object.entries(conns)) if (name !== who) expect(c.received).toEqual([]);
    expect(engine.seq()).toBe(0);
    expect(log.entries).toEqual([]);
  });

  it('assigns strictly increasing seqs across concurrent senders', async () => {
    const { engine, log } = setup();
    const host = fakeConnection(T.host, { isHost: true });
    const host2 = fakeConnection(T.host, { isHost: true });
    const alice = fakeConnection(T.alice);
    for (const c of [host, host2, alice]) await engine.onConnect(c);

    const sends: Promise<void>[] = [];
    for (let i = 0; i < 20; i++) {
      // Not awaited one by one: all 20 are in flight together.
      sends.push(
        Promise.resolve(
          engine.onIntent(i % 2 ? host : host2, rename(`N${String(i)}`, `r${String(i)}`)),
        ),
      );
    }
    await Promise.all(sends);

    expect(log.entries.map((e) => e.envelope.seq)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
    const acks = [...ofType(host, 'ack'), ...ofType(host2, 'ack')].map((a) => a.seq);
    expect(acks.sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(new Set(log.entries.map((e) => e.envelope.id)).size).toBe(20);
    for (const c of [host, host2, alice]) {
      expect(clientView(c).seq).toBe(20);
    }
    expect(clientView(alice).state).toEqual(
      visibleTo({ kind: 'seat', seatId: T.seatA }, engine.state()),
    );
    expect(clientView(host).state).toEqual(engine.state());
  });

  it('continues from initialSeq', async () => {
    const { engine, log } = setup({ initialSeq: 41 });
    const host = fakeConnection(T.host, { isHost: true });
    await engine.onConnect(host);
    await engine.onIntent(host, rename('Again', 'r'));
    expect(log.entries[0]?.envelope.seq).toBe(42);
    expect(ofType(host, 'snapshot')[0]?.seq).toBe(41);
  });

  it('attaches host-generated rng values when the action needs them', async () => {
    const { engine, log } = setup({ rngCount: () => 3 });
    const host = fakeConnection(T.host, { isHost: true });
    await engine.onConnect(host);
    await engine.onIntent(host, rename('Dice', 'r'));
    const rng = log.entries[0]?.envelope.rng ?? [];
    expect(rng).toHaveLength(3);
    for (const v of rng) expect(v >= 0 && v < 1).toBe(true);
  });

  it('does not commit when the log append fails', async () => {
    const onError = vi.fn();
    const { engine, log } = setup({ onError });
    const host = fakeConnection(T.host, { isHost: true });
    const alice = fakeConnection(T.alice);
    for (const c of [host, alice]) await engine.onConnect(c);
    alice.clear();
    host.clear();
    log.fail = true;

    await engine.onIntent(host, rename('Lost', 'r1'));

    expect(host.received).toEqual([
      expect.objectContaining({ t: 'reject', clientRef: 'r1', reason: 'conflict' }),
    ]);
    expect(alice.received).toEqual([]);
    expect(engine.seq()).toBe(0);
    expect(engine.state().scenes[T.scene]?.name).toBe('Cave');
    expect(onError).toHaveBeenCalledOnce();

    log.fail = false;
    await engine.onIntent(host, rename('Kept', 'r2'));
    expect(ofType(host, 'ack')).toEqual([{ t: 'ack', clientRef: 'r2', seq: 1 }]);
  });

  it('stops sending to a disconnected connection and drops its queued intents', async () => {
    const { engine, log } = setup();
    const host = fakeConnection(T.host, { isHost: true });
    const alice = fakeConnection(T.alice);
    for (const c of [host, alice]) await engine.onConnect(c);
    engine.onDisconnect(alice);
    alice.clear();
    await engine.onIntent(host, rename('Later', 'r'));
    expect(alice.received).toEqual([]);
    await engine.onIntent(alice, rename('Ghost', 'g'));
    expect(log.entries).toHaveLength(1);
  });

  it('ignores ephemerals until the relay exists (M1-07)', async () => {
    const { engine } = setup();
    const alice = fakeConnection(T.alice);
    const bob = fakeConnection(T.bob);
    for (const c of [alice, bob]) await engine.onConnect(c);
    bob.clear();
    await engine.onEphemeral(alice, { t: 'ephemeral', channel: 'cursor', data: { x: 1 } });
    expect(bob.received).toEqual([]);
  });
});

describe('seat changes', () => {
  it('auto-seats a returning identity without writing another action', async () => {
    const { engine, log } = setup();
    const alice = fakeConnection(T.alice);

    await engine.onConnect(alice);

    expect(alice.received).toEqual([
      expect.objectContaining({ t: 'snapshot', seq: 0, seatId: T.seatA }),
    ]);
    expect(log.entries).toEqual([]);
    expectNoSecrets(alice);
  });

  it('a join switches the joiner to its seat audience with a fresh snapshot', async () => {
    const { engine } = setup();
    const host = fakeConnection(T.host, { isHost: true });
    const bob = fakeConnection(T.bob);
    for (const c of [host, bob]) await engine.onConnect(c);
    host.clear();
    bob.clear();

    await engine.onJoin(bob, { t: 'join', seatId: T.seatB });

    expect(bob.received).toHaveLength(1);
    const snap = ofType(bob, 'snapshot')[0];
    expect(snap).toMatchObject({ seq: 1, seatId: T.seatB });
    expect((snap?.state as Campaign).seats[T.seatB]?.identityId).toBe(T.bob);
    expect(ofType(host, 'patch').map((p) => p.seq)).toEqual([1]);
    expectNoSecrets(bob);

    // Seated now: an action it is allowed nothing new, but its actor carries the seat.
    await engine.onIntent(bob, rename('x', 'r'));
    expect(ofType(bob, 'reject')[0]?.reason).toBe('forbidden');
  });

  it('session.join as an intent: snapshot for the new audience, then the ack', async () => {
    const { engine, log } = setup();
    const bob = fakeConnection(T.bob);
    await engine.onConnect(bob);
    bob.clear();
    await engine.onIntent(bob, intent('session.join', { seatId: T.seatB, identityId: T.bob }, 'j'));
    expect(bob.received.map((m) => m.t)).toEqual(['snapshot', 'ack']);
    expect(log.entries[0]?.envelope.actor).toEqual({ kind: 'seat', identityId: T.bob });
  });

  it('an unavailable seat gives a non-fatal seat-unavailable error', async () => {
    const { engine } = setup();
    const bob = fakeConnection(T.bob);
    await engine.onConnect(bob);
    bob.clear();
    await engine.onJoin(bob, { t: 'join', seatId: T.seatA });
    expect(bob.received).toEqual([
      { t: 'error', code: 'seat-unavailable', message: 'seat unavailable', fatal: false },
    ]);
    expect(engine.seq()).toBe(0);
  });

  it('a seat released by the host drops its occupant to the spectator view', async () => {
    const { engine } = setup();
    const host = fakeConnection(T.host, { isHost: true });
    const alice = fakeConnection(T.alice);
    for (const c of [host, alice]) await engine.onConnect(c);
    alice.clear();
    await engine.onIntent(host, intent('seat.release', { seatId: T.seatA }, 'r'));
    expect(alice.received).toEqual([
      expect.objectContaining({ t: 'snapshot', seq: 1, seatId: null }),
    ]);
    expectNoSecrets(alice);
  });

  it('keeps a per-session seat across disconnect so the identity can reconnect', async () => {
    const campaign = fixtureCampaign();
    const seat = campaign.seats[T.seatB];
    if (seat) seat.binding = 'session';
    const { engine, log } = setup({ campaign });
    const bob = fakeConnection(T.bob);
    await engine.onConnect(bob);
    await engine.onJoin(bob, { t: 'join', seatId: T.seatB });
    engine.onDisconnect(bob);

    const back = fakeConnection(T.bob, { lastSeq: 1 });
    await engine.onConnect(back);

    expect(back.received).toEqual([
      expect.objectContaining({ t: 'snapshot', seq: 1, seatId: T.seatB }),
    ]);
    expect(log.entries.map((entry) => entry.envelope.type)).toEqual(['session.join']);
    expectNoSecrets(back);
  });
});

describe('session end', () => {
  it('releases only per-session bindings through the action pipeline', async () => {
    const campaign = fixtureCampaign();
    const seat = campaign.seats[T.seatB];
    if (seat) {
      seat.binding = 'session';
      seat.identityId = T.bob;
    }
    const { engine, log } = setup({ campaign });
    const bob = fakeConnection(T.bob);
    await engine.onConnect(bob);
    bob.clear();

    await engine.endSession();

    expect(engine.state().seats[T.seatA]?.identityId).toBe(T.alice);
    expect(engine.state().seats[T.seatB]?.identityId).toBeNull();
    expect(log.entries.map((entry) => entry.envelope.type)).toEqual(['seat.release']);
    expect(log.entries[0]?.envelope.actor).toEqual({ kind: 'host' });
    expect(bob.received).toEqual([
      expect.objectContaining({ t: 'snapshot', seq: 1, seatId: null }),
    ]);
    expectNoSecrets(bob);
  });
});

describe('reconnect', () => {
  async function played(over: Partial<EngineOptions> = {}) {
    const ctx = setup(over);
    const host = fakeConnection(T.host, { isHost: true });
    await ctx.engine.onConnect(host);
    for (let i = 1; i <= 3; i++)
      await ctx.engine.onIntent(host, rename(`S${String(i)}`, `r${String(i)}`));
    return { ...ctx, host };
  }

  it('replays only the missed patches when they are cached', async () => {
    const { engine } = await played();
    const alice = fakeConnection(T.alice, { lastSeq: 1 });
    await engine.onConnect(alice);
    expect(alice.received.map((m) => [m.t, 'seq' in m ? m.seq : null])).toEqual([
      ['patch', 2],
      ['patch', 3],
    ]);
  });

  it.each([
    ['no lastSeq', undefined],
    ['already up to date', 3],
    ['a seq from the future (host restarted)', 99],
  ])('sends a snapshot for %s', async (_name, lastSeq) => {
    const { engine } = await played();
    const alice = fakeConnection(T.alice, lastSeq === undefined ? {} : { lastSeq });
    await engine.onConnect(alice);
    expect(alice.received).toEqual([expect.objectContaining({ t: 'snapshot', seq: 3 })]);
  });

  it('falls back to a snapshot when the missed range is no longer cached', async () => {
    const { engine } = await played({ replayLimit: 2 });
    const alice = fakeConnection(T.alice, { lastSeq: 0 });
    await engine.onConnect(alice);
    expect(alice.received.map((m) => m.t)).toEqual(['snapshot']);
    const again = fakeConnection(T.alice, { lastSeq: 1 });
    await engine.onConnect(again);
    expect(again.received.map((m) => m.t)).toEqual(['patch', 'patch']);
  });

  it('falls back to a snapshot when the audience changed since lastSeq', async () => {
    const { engine, host } = await played();
    await engine.onIntent(host, intent('seat.assign', { seatId: T.seatB, identityId: T.bob }, 'a'));
    const bob = fakeConnection(T.bob, { lastSeq: 2 });
    await engine.onConnect(bob);
    expect(bob.received).toEqual([
      expect.objectContaining({ t: 'snapshot', seq: 4, seatId: T.seatB }),
    ]);
  });
});

describe('non-leak (PERM-03)', () => {
  it('player and spectator sockets never receive DM-layer data across a session', async () => {
    const { engine } = setup();
    const host = fakeConnection(T.host, { isHost: true });
    const alice = fakeConnection(T.alice);
    const bob = fakeConnection(T.bob);
    const carol = fakeConnection(T.carol);
    for (const c of [host, alice, bob, carol]) await engine.onConnect(c);

    await engine.onIntent(host, intent('scene.create', { sceneId: T.newScene, name: 'Two' }, 'a'));
    await engine.onIntent(host, rename('Renamed', 'b'));
    await engine.onIntent(host, intent('scene.activate', { sceneId: T.newScene }, 'c'));
    await engine.onJoin(bob, { t: 'join', seatId: T.seatB });
    await engine.onIntent(host, intent('seat.release', { seatId: T.seatA }, 'd'));
    await engine.onIntent(host, intent('grid.update', { sceneId: T.scene, snap: false }, 'e'));
    const lateAlice = fakeConnection(T.alice, { lastSeq: 1 });
    const lateCarol = fakeConnection(T.carol, { lastSeq: 2 });
    for (const c of [lateAlice, lateCarol]) await engine.onConnect(c);

    expectNoSecrets(alice, bob, carol, lateAlice, lateCarol);
    expect(host.wire()).toContain('SECRET-DM');

    // Every non-host view equals exactly the filtered authoritative state.
    const final = engine.state();
    const expectView = (c: FakeConnection, audience: Audience) => {
      expect(clientView(c).state).toEqual(visibleTo(audience, final));
    };
    expectView(alice, { kind: 'spectators' });
    expectView(bob, { kind: 'seat', seatId: T.seatB });
    expectView(carol, { kind: 'spectators' });
    // Replay on top of what carol held at seq 2 converges to the same view.
    const carolAt2 = carol.received.filter((m) => !('seq' in m) || m.seq <= 2);
    expect(lateCarol.received.every((m) => m.t === 'patch')).toBe(true);
    expect(clientView(lateCarol, carolAt2).state).toEqual(visibleTo({ kind: 'spectators' }, final));
    expectView(host, { kind: 'host' });
  });
});
