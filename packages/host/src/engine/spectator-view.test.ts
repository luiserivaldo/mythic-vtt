import { applyPatches, enablePatches, type Patch } from 'immer';
import { describe, expect, it } from 'vitest';
import type { ServerMessage } from '@mythic/protocol';
import { visibleTo, type Campaign } from '@mythic/shared';
import { audienceFor, audienceViewKey, spectatorSourceSeat } from './audience.js';
import { createEngine } from './engine.js';
import {
  OWNER_LABELS,
  T,
  fakeClock,
  fakeConnection,
  fakeRandom,
  fixtureWithOwnerLabels,
  memoryLog,
  tid,
  type FakeConnection,
} from './testing.js';

enablePatches();

const ALICE_ONLY = OWNER_LABELS.seatA;
const BOB_ONLY = OWNER_LABELS.seatB;

function setup(initialSpectatorSeatId?: string | null) {
  const engine = createEngine({
    campaign: fixtureWithOwnerLabels(),
    sessionId: tid(20),
    store: memoryLog(),
    clock: fakeClock(),
    random: fakeRandom(),
    onError: () => undefined,
    ...(initialSpectatorSeatId !== undefined ? { initialSpectatorSeatId } : {}),
  });
  const watcher = (): FakeConnection => ({
    ...fakeConnection(T.carol),
    isSpectator: true,
  });
  return { engine, watcher };
}

const snapshots = (c: FakeConnection) =>
  c.received.filter((m): m is Extract<ServerMessage, { t: 'snapshot' }> => m.t === 'snapshot');

/** What the spectator holds after applying every message, like the client store. */
function held(c: FakeConnection): Campaign {
  let state: Campaign | null = null;
  for (const m of c.received) {
    if (m.t === 'snapshot') state = m.state as Campaign;
    else if (m.t === 'patch' && state) state = applyPatches(state, m.patches as Patch[]);
  }
  if (!state) throw new Error('no snapshot');
  return state;
}

describe('spectatorSourceSeat / audienceFor (M4-02)', () => {
  const state = fixtureWithOwnerLabels();
  const spectator = { identityId: T.carol, isHost: false, isSpectator: true } as const;

  it('defaults to the shared spectator audience', () => {
    expect(audienceFor(state, spectator)).toEqual({ kind: 'spectators' });
    expect(audienceFor(state, { ...spectator, spectatorSeatId: null })).toEqual({
      kind: 'spectators',
    });
    expect(audienceViewKey(state, spectator)).toBe('spectators');
  });

  it('uses a chosen player seat, with a key distinct from that seat’s own members', () => {
    const chosen = { ...spectator, spectatorSeatId: T.seatA };
    expect(audienceFor(state, chosen)).toEqual({ kind: 'seat', seatId: T.seatA });
    const own = { identityId: T.alice, isHost: false } as const;
    expect(audienceViewKey(state, chosen)).not.toBe(audienceViewKey(state, own));
    expect(audienceViewKey(state, chosen)).not.toBe('spectators');
  });

  it('falls back to the player view for a co-DM seat or a missing seat', () => {
    expect(spectatorSourceSeat(state, T.coDm)).toBeUndefined();
    expect(spectatorSourceSeat(state, tid(30))).toBeUndefined();
    expect(spectatorSourceSeat(state, '')).toBeUndefined();
    expect(audienceFor(state, { ...spectator, spectatorSeatId: T.coDm })).toEqual({
      kind: 'spectators',
    });
  });

  it('does not change who a non-spectator is', () => {
    const alice = { identityId: T.alice, isHost: false, spectatorSeatId: T.seatB } as const;
    expect(audienceFor(state, alice)).toEqual({ kind: 'seat', seatId: T.seatA });
  });
});

describe('DM-chosen spectator view (M4-02 / SES-11 / PERM-03)', () => {
  it('shows the player view by default, with no DM-layer data and no owner-only labels', async () => {
    const { engine, watcher } = setup();
    const w = watcher();
    await engine.onConnect(w);
    const wire = w.wire();
    for (const secret of ['SECRET-DM', 'HIDDEN-NAME', ALICE_ONLY, BOB_ONLY])
      expect(wire).not.toContain(secret);
    expect(snapshots(w)[0]?.state).toEqual(visibleTo({ kind: 'spectators' }, engine.state()));
  });

  it('switches live: one fresh snapshot per change, exactly the chosen seat’s view', async () => {
    const { engine, watcher } = setup();
    const w = watcher();
    await engine.onConnect(w);

    expect(await engine.setSpectatorView(T.seatA)).toBe(true);
    expect(snapshots(w)).toHaveLength(2);
    const asA = snapshots(w)[1];
    // The viewer is never told it holds the seat.
    expect(asA?.seatId).toBeNull();
    expect(asA?.state).toEqual(visibleTo({ kind: 'seat', seatId: T.seatA }, engine.state()));
    expect(w.wire()).toContain(ALICE_ONLY);
    expect(JSON.stringify(asA)).not.toContain(BOB_ONLY);
    expect(JSON.stringify(asA)).not.toContain('SECRET-DM');

    expect(await engine.setSpectatorView(T.seatB)).toBe(true);
    const asB = JSON.stringify(snapshots(w)[2]);
    expect(asB).toContain(BOB_ONLY);
    expect(asB).not.toContain(ALICE_ONLY);
    expect(asB).not.toContain('SECRET-DM');

    expect(await engine.setSpectatorView(null)).toBe(true);
    const players = JSON.stringify(snapshots(w)[3]);
    for (const secret of ['SECRET-DM', ALICE_ONLY, BOB_ONLY]) expect(players).not.toContain(secret);
    expect(engine.spectatorView()).toBeNull();
  });

  it('does not resend when the effective view is unchanged', async () => {
    const { engine, watcher } = setup();
    const w = watcher();
    await engine.onConnect(w);
    await engine.setSpectatorView(null);
    expect(snapshots(w)).toHaveLength(1);
    await engine.setSpectatorView(T.seatA);
    await engine.setSpectatorView(T.seatA);
    expect(snapshots(w)).toHaveLength(2);
  });

  it('rejects a co-DM or unknown seat and keeps the current view', async () => {
    const { engine, watcher } = setup(T.seatA);
    const w = watcher();
    await engine.onConnect(w);
    expect(await engine.setSpectatorView(T.coDm)).toBe(false);
    expect(await engine.setSpectatorView(tid(30))).toBe(false);
    expect(engine.spectatorView()).toBe(T.seatA);
    expect(snapshots(w)).toHaveLength(1);
    expect(w.wire()).not.toContain('SECRET-DM');
  });

  it('starts from the persisted choice', async () => {
    const { engine, watcher } = setup(T.seatB);
    const w = watcher();
    await engine.onConnect(w);
    expect(w.wire()).toContain(BOB_ONLY);
    expect(w.wire()).not.toContain(ALICE_ONLY);
  });

  it('keeps patches equal to the chosen seat’s patches and converges to its view', async () => {
    const { engine, watcher } = setup();
    const host = fakeConnection(T.host, { isHost: true });
    const alice = fakeConnection(T.alice);
    const w = watcher();
    for (const c of [host, alice, w]) await engine.onConnect(c);
    await engine.setSpectatorView(T.seatA);
    alice.clear();
    w.clear();
    await engine.onIntent(host, {
      t: 'intent',
      type: 'scene.rename',
      payload: { sceneId: T.scene, name: 'Renamed' },
      clientRef: 'r1',
    });
    const patchOf = (c: FakeConnection) => c.received.filter((m) => m.t === 'patch');
    expect(patchOf(w)).toEqual(patchOf(alice));
    expect(JSON.stringify(w.received)).not.toContain('SECRET-DM');
  });

  it('falls back to the player view if the chosen seat is promoted to co-DM', async () => {
    const { engine, watcher } = setup(T.seatA);
    const host = fakeConnection(T.host, { isHost: true });
    const alice = fakeConnection(T.alice);
    const w = watcher();
    for (const c of [host, alice, w]) await engine.onConnect(c);
    alice.clear();
    w.clear();
    await engine.onIntent(host, {
      t: 'intent',
      type: 'seat.update',
      payload: { seatId: T.seatA, role: 'codm' },
      clientRef: 'promote',
    });
    // The real seat now legitimately sees the DM layer; the spectator must not.
    expect(alice.wire()).toContain('SECRET-DM');
    expect(snapshots(w)).toHaveLength(1);
    expect(w.wire()).not.toContain('SECRET-DM');
    expect(snapshots(w)[0]?.state).toEqual(visibleTo({ kind: 'spectators' }, engine.state()));
    expect(held(w)).toEqual(visibleTo({ kind: 'spectators' }, engine.state()));
  });

  it('never lets a seat-view spectator act', async () => {
    const { engine, watcher } = setup(T.seatA);
    const w = watcher();
    await engine.onConnect(w);
    await engine.onIntent(w, {
      t: 'intent',
      type: 'scene.rename',
      payload: { sceneId: T.scene, name: 'Nope' },
      clientRef: 'x',
    });
    expect(w.received.filter((m) => m.t === 'reject')).toEqual([
      { t: 'reject', clientRef: 'x', reason: 'forbidden' },
    ]);
    expect(engine.seq()).toBe(0);
  });
});
