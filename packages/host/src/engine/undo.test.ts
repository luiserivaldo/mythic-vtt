import { describe, expect, it } from 'vitest';
import type { ServerMessage } from '@mythic/protocol';
import { reduceAction } from '@mythic/shared';
import { createEngine } from './engine.js';
import { pathsOverlap } from './undo.js';
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

const SESSION = tid(20);

/** The shared fixture's entities are plain; `token.move` needs a token component. */
function campaign() {
  const state = fixtureCampaign();
  const entities = state.scenes[T.scene]?.entities ?? {};
  for (const id of [T.token, T.secret]) {
    const entity = entities[id];
    if (entity) entity.token = { sizeCells: 1, heightCells: 1, labelVisibility: 'all' };
  }
  return state;
}

function setup(state = campaign()) {
  const log = memoryLog();
  const engine = createEngine({
    campaign: state,
    sessionId: SESSION,
    store: log,
    clock: fakeClock(),
    random: fakeRandom(),
    onError: () => undefined,
  });
  const host = fakeConnection(T.host, { isHost: true });
  const alice = fakeConnection(T.alice);
  const watcher = { ...fakeConnection(T.carol), isSpectator: true };
  return { engine, log, host, alice, watcher };
}

let ref = 0;
async function send(
  engine: ReturnType<typeof setup>['engine'],
  conn: FakeConnection,
  type: string,
  payload: unknown,
) {
  const clientRef = `r${String((ref += 1))}`;
  conn.clear();
  await engine.onIntent(conn, { t: 'intent', type, payload, clientRef });
  const answer = conn.received.find(
    (m): m is Extract<ServerMessage, { t: 'ack' | 'reject' }> =>
      (m.t === 'ack' || m.t === 'reject') && m.clientRef === clientRef,
  );
  if (!answer) throw new Error('no answer');
  return answer;
}

const move = (entityId: string, x: number) => ({
  sceneId: T.scene,
  entityId,
  to: { x, y: 0, z: 0 },
});
const x = (engine: ReturnType<typeof setup>['engine'], entityId = T.token) =>
  engine.state().scenes[T.scene]?.entities[entityId]?.transform.position.x;

async function ready(state?: ReturnType<typeof campaign>) {
  const s = setup(state);
  await s.engine.onConnect(s.host);
  await s.engine.onConnect(s.alice);
  await s.engine.onConnect(s.watcher);
  return s;
}

describe('pathsOverlap', () => {
  it('matches equal and nested paths, and treats an array index as its array', () => {
    expect(pathsOverlap(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(pathsOverlap(['a'], ['a', 'b', 'c'])).toBe(true);
    expect(pathsOverlap(['a', 'b'], ['a', 'c'])).toBe(false);
    expect(pathsOverlap(['a', 'owners', 0], ['a', 'owners', 1])).toBe(true);
    expect(pathsOverlap(['a', 'owners', 0], ['a', 'name'])).toBe(false);
  });
});

describe('history.undo', () => {
  it.each(['entity.setOwners', 'entity.delete'])(
    'restores entities without archived owners through %s',
    async (type) => {
      const { engine, host, alice, watcher, log } = await ready();
      expect(
        (
          await send(engine, host, 'entity.setOwners', {
            sceneId: T.scene,
            entityId: T.token,
            owners: [T.seatA, T.seatB],
          })
        ).t,
      ).toBe('ack');
      const original = structuredClone(engine.state().scenes[T.scene]?.entities[T.token]);
      const changed = await send(engine, host, type, {
        sceneId: T.scene,
        entityId: T.token,
        ...(type === 'entity.setOwners' ? { owners: [T.seatB] } : {}),
      });
      const moved = await send(engine, host, 'token.move', move(T.secret, 9));
      expect((await send(engine, host, 'seat.archive', { seatId: T.seatA })).t).toBe('ack');
      if (changed.t !== 'ack' || moved.t !== 'ack') throw new Error('setup');
      const entries = log.entries.length;
      alice.clear();
      watcher.clear();

      expect(
        await send(engine, host, 'history.undo', {
          targetSeqs: [changed.seq, moved.seq],
        }),
      ).toMatchObject({ t: 'ack' });
      expect(engine.state().scenes[T.scene]?.entities[T.token]).toEqual({
        ...original,
        owners: [T.seatB],
      });
      expect(engine.state().seats[T.seatA]?.archived).toBe(true);
      expect(log.entries).toHaveLength(entries + 1);
      for (const conn of [alice, watcher]) expect(conn.wire()).not.toContain(T.seatA);
      expect(x(engine, T.secret)).toBe(0);
      let replayed = campaign();
      for (const entry of log.entries) replayed = reduceAction(replayed, entry.envelope).state;
      expect(replayed).toEqual(engine.state());
    },
  );

  it('Ctrl+Z reverts only the caller’s own last action, step by step', async () => {
    const { engine, host, alice } = await ready();
    expect((await send(engine, alice, 'token.move', move(T.token, 3))).t).toBe('ack');
    expect((await send(engine, alice, 'token.move', move(T.token, 5))).t).toBe('ack');
    expect((await send(engine, host, 'token.move', move(T.secret, 9))).t).toBe('ack');

    expect((await send(engine, alice, 'history.undo', {})).t).toBe('ack');
    expect(x(engine)).toBe(3);
    expect(x(engine, T.secret)).toBe(9); // the DM’s move is untouched
    expect((await send(engine, alice, 'history.undo', {})).t).toBe('ack');
    expect(x(engine)).toBe(0);
    expect(await send(engine, alice, 'history.undo', {})).toMatchObject({
      t: 'reject',
      reason: 'forbidden',
    });

    expect((await send(engine, host, 'history.undo', {})).t).toBe('ack');
    expect(x(engine, T.secret)).toBe(0);
  });

  it('is logged as an action and replays to the same state', async () => {
    const { engine, log, host, alice } = await ready();
    const start = campaign();
    await send(engine, alice, 'token.move', move(T.token, 3));
    await send(engine, host, 'token.move', move(T.secret, 4));
    await send(engine, alice, 'history.undo', {});
    expect(log.entries.map((e) => e.envelope.type)).toEqual([
      'token.move',
      'token.move',
      'history.undo',
    ]);
    let replayed = start;
    for (const entry of log.entries) replayed = reduceAction(replayed, entry.envelope).state;
    expect(replayed).toEqual(engine.state());
  });

  it('lets a seat undo only its own actions, and the DM undo anyone’s', async () => {
    const { engine, host, alice } = await ready();
    const hostMove = await send(engine, host, 'token.move', move(T.token, 2));
    if (hostMove.t !== 'ack') throw new Error('setup');
    expect(await send(engine, alice, 'history.undo', { targetSeqs: [hostMove.seq] })).toMatchObject(
      { t: 'reject', reason: 'forbidden' },
    );
    expect(x(engine)).toBe(2);
    expect((await send(engine, host, 'history.undo', { targetSeqs: [hostMove.seq] })).t).toBe(
      'ack',
    );
    expect(x(engine)).toBe(0);
  });

  it('rejects a seat when someone else touched the same place later (D34), but not the DM', async () => {
    const { engine, host, alice } = await ready();
    const first = await send(engine, alice, 'token.move', move(T.token, 3));
    await send(engine, host, 'token.move', move(T.token, 8));
    if (first.t !== 'ack') throw new Error('setup');
    expect(await send(engine, alice, 'history.undo', { targetSeqs: [first.seq] })).toMatchObject({
      t: 'reject',
      reason: 'conflict',
    });
    expect(x(engine)).toBe(8);
    expect((await send(engine, host, 'history.undo', { targetSeqs: [first.seq] })).t).toBe('ack');
    expect(x(engine)).toBe(0);
  });

  it('applies a multi-selection atomically, newest first', async () => {
    const { engine, host, alice } = await ready();
    const a = await send(engine, alice, 'token.move', move(T.token, 3));
    const b = await send(engine, alice, 'token.move', move(T.token, 6));
    const c = await send(engine, host, 'token.move', move(T.secret, 7));
    if (a.t !== 'ack' || b.t !== 'ack' || c.t !== 'ack') throw new Error('setup');

    // One target that is invalid rejects the whole batch.
    expect(await send(engine, host, 'history.undo', { targetSeqs: [a.seq, 9999] })).toMatchObject({
      t: 'reject',
      reason: 'forbidden',
    });
    expect(x(engine)).toBe(6);

    expect((await send(engine, host, 'history.undo', { targetSeqs: [a.seq, b.seq] })).t).toBe(
      'ack',
    );
    expect(x(engine)).toBe(0);
    expect(x(engine, T.secret)).toBe(7);
    // Already undone: the same entries cannot be undone twice.
    expect(await send(engine, host, 'history.undo', { targetSeqs: [a.seq] })).toMatchObject({
      t: 'reject',
      reason: 'forbidden',
    });
  });

  it('can undo past an earlier undo (the pair nets out)', async () => {
    const { engine, alice } = await ready();
    await send(engine, alice, 'token.move', move(T.token, 3));
    await send(engine, alice, 'token.move', move(T.token, 5));
    await send(engine, alice, 'history.undo', {});
    // The first move is still undoable although the undo of the second touched the same path.
    expect((await send(engine, alice, 'history.undo', {})).t).toBe('ack');
    expect(x(engine)).toBe(0);
  });

  it('refuses types that must not be replayed backwards', async () => {
    const { engine, host } = await ready();
    const created = await send(engine, host, 'seat.create', { seatId: tid(30), label: 'New' });
    if (created.t !== 'ack') throw new Error('setup');
    expect(await send(engine, host, 'history.undo', { targetSeqs: [created.seq] })).toMatchObject({
      t: 'reject',
      reason: 'forbidden',
    });
    expect(await send(engine, host, 'history.undo', {})).toMatchObject({ reason: 'forbidden' });
  });

  it('ignores anything a client adds: forged patches are rejected, not applied', async () => {
    const { engine, alice } = await ready();
    await send(engine, alice, 'token.move', move(T.token, 3));
    const forged = await send(engine, alice, 'history.undo', {
      targetSeqs: [1],
      patches: [{ op: 'replace', path: ['name'], value: 'pwned' }],
    });
    expect(forged).toMatchObject({ t: 'reject', reason: 'invalid-payload' });
    expect(engine.state().name).not.toBe('pwned');
  });

  it('a spectator cannot undo', async () => {
    const { engine, host, watcher } = await ready();
    await send(engine, host, 'token.move', move(T.token, 2));
    expect(await send(engine, watcher, 'history.undo', {})).toMatchObject({
      t: 'reject',
      reason: 'forbidden',
    });
  });

  it('leaks nothing about an undone DM-layer action to players or spectators', async () => {
    const { engine, host, alice, watcher } = await ready();
    alice.clear();
    watcher.clear();
    const moved = await send(engine, host, 'token.move', move(T.secret, 11));
    if (moved.t !== 'ack') throw new Error('setup');
    expect((await send(engine, host, 'history.undo', { targetSeqs: [moved.seq] })).t).toBe('ack');
    expect(x(engine, T.secret)).toBe(0);

    for (const conn of [alice, watcher]) {
      const wire = conn.wire();
      for (const secret of SECRETS) expect(wire).not.toContain(secret);
      expect(wire).not.toContain(T.secret);
      // They still receive both seqs, but with nothing in them.
      const patches = conn.received.filter(
        (m): m is Extract<ServerMessage, { t: 'patch' }> => m.t === 'patch',
      );
      expect(patches.map((p) => p.patches)).toEqual([[], []]);
    }
    // A seat probing that seq gets the same answer as for one that never existed.
    const probe = await send(engine, alice, 'history.undo', { targetSeqs: [moved.seq] });
    const missing = await send(engine, alice, 'history.undo', { targetSeqs: [4242] });
    expect(probe).toMatchObject({ t: 'reject', reason: 'forbidden' });
    expect({ ...probe, clientRef: '' }).toEqual({ ...missing, clientRef: '' });
  });
});

describe('history.undo of a door toggle (FOG-01, D47)', () => {
  const DOOR = tid(15);
  const OTHER_DOOR = tid(16);

  /** Two closed doors on the map layer; seat A holds the interact permission. */
  function withDoors() {
    const state = campaign();
    const scene = state.scenes[T.scene];
    const seat = state.seats[T.seatA];
    if (!scene || !seat) throw new Error('fixture');
    for (const id of [DOOR, OTHER_DOOR])
      scene.entities[id] = {
        id,
        layer: 'map',
        name: '',
        owners: [],
        transform: {
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          scale: { x: 1, y: 1, z: 1 },
        },
        wall: {
          points: [
            { x: 0, z: 0 },
            { x: 1, z: 0 },
          ],
          door: { open: false },
        },
      };
    seat.tools = { measure: true, draw: true, pins: true, interact: true };
    return state;
  }
  const toggle = (entityId: string, open: boolean) => ({ sceneId: T.scene, entityId, open });
  const doorOf = (engine: ReturnType<typeof setup>['engine'], id = DOOR) =>
    engine.state().scenes[T.scene]?.entities[id]?.wall?.door;

  it('a door-tool player undoes their own toggle', async () => {
    const { engine, alice } = await ready(withDoors());
    expect((await send(engine, alice, 'wall.setDoor', toggle(DOOR, true))).t).toBe('ack');
    expect(doorOf(engine)).toEqual({ open: true });

    expect((await send(engine, alice, 'history.undo', {})).t).toBe('ack');
    expect(doorOf(engine)).toEqual({ open: false });

    // Picking the seq explicitly works too.
    const opened = await send(engine, alice, 'wall.setDoor', toggle(DOOR, true));
    if (opened.t !== 'ack') throw new Error('setup');
    expect((await send(engine, alice, 'history.undo', { targetSeqs: [opened.seq] })).t).toBe('ack');
    expect(doorOf(engine)).toEqual({ open: false });
  });

  it('Ctrl+Z skips a toggle the seat may no longer make and undoes the older move', async () => {
    const { engine, host, alice } = await ready(withDoors());
    expect((await send(engine, alice, 'token.move', move(T.token, 3))).t).toBe('ack');
    const opened = await send(engine, alice, 'wall.setDoor', toggle(DOOR, true));
    if (opened.t !== 'ack') throw new Error('setup');
    expect(
      (await send(engine, host, 'seat.update', { seatId: T.seatA, tools: { interact: false } })).t,
    ).toBe('ack');

    expect((await send(engine, alice, 'history.undo', {})).t).toBe('ack');
    expect(x(engine)).toBe(0); // the move is undone
    expect(doorOf(engine)).toEqual({ open: true }); // the door stays as it is
    // Asking for the toggle by seq is refused; nothing else is left to undo.
    expect(await send(engine, alice, 'history.undo', { targetSeqs: [opened.seq] })).toMatchObject({
      t: 'reject',
      reason: 'forbidden',
    });
    expect(await send(engine, alice, 'history.undo', {})).toMatchObject({
      t: 'reject',
      reason: 'forbidden',
    });
    // The DM may still undo it.
    expect((await send(engine, host, 'history.undo', { targetSeqs: [opened.seq] })).t).toBe('ack');
    expect(doorOf(engine)).toEqual({ open: false });
  });

  it('a door made secret is skipped exactly like a revoked tool, so nothing leaks', async () => {
    const replies = async (hide: 'secret' | 'revoke') => {
      const { engine, host, alice } = await ready(withDoors());
      expect((await send(engine, alice, 'token.move', move(T.token, 3))).t).toBe('ack');
      const opened = await send(engine, alice, 'wall.setDoor', toggle(DOOR, true));
      if (opened.t !== 'ack') throw new Error('setup');
      const changed =
        hide === 'secret'
          ? await send(engine, host, 'entity.update', {
              sceneId: T.scene,
              entityId: DOOR,
              changes: {
                wall: {
                  points: [
                    { x: 0, z: 0 },
                    { x: 1, z: 0 },
                  ],
                  door: { open: true, secret: true },
                },
              },
            })
          : await send(engine, host, 'seat.update', {
              seatId: T.seatA,
              tools: { interact: false },
            });
      expect(changed.t).toBe('ack');
      alice.clear();
      const bySeq = await send(engine, alice, 'history.undo', { targetSeqs: [opened.seq] });
      const ctrlZ = await send(engine, alice, 'history.undo', {});
      expect(ctrlZ.t).toBe('ack');
      expect(x(engine)).toBe(0);
      const last = await send(engine, alice, 'history.undo', {});
      const strip = (m: object) => ({ ...m, clientRef: '' });
      return { bySeq: strip(bySeq), last: strip(last), wire: alice.wire() };
    };
    const secret = await replies('secret');
    const revoked = await replies('revoke');
    expect(secret.bySeq).toMatchObject({ t: 'reject', reason: 'forbidden' });
    expect(secret.bySeq).toEqual(revoked.bySeq);
    expect(secret.last).toEqual(revoked.last);
    expect(secret.wire).not.toContain('secret');
  });
});
