import { describe, expect, it } from 'vitest';
import type { ServerMessage } from '@mythic/protocol';
import { reduceAction, type Campaign } from '@mythic/shared';
import type { LogEntry } from '../storage/types.js';
import { createEngine } from './engine.js';
import { ROLLBACK_MAX_ENTRIES, planRollback } from './rollback.js';
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
const SECOND_SCENE = tid(40);
const FUTURE = tid(41);
const NEW_SEAT = tid(42);

function campaign() {
  const state = fixtureCampaign();
  const entities = state.scenes[T.scene]?.entities ?? {};
  for (const id of [T.token, T.secret]) {
    const entity = entities[id];
    if (entity) entity.token = { sizeCells: 1, heightCells: 1, labelVisibility: 'all' };
  }
  return state;
}

function setup(options: { withLog?: boolean } = {}) {
  const log = memoryLog();
  const engine = createEngine({
    campaign: campaign(),
    sessionId: SESSION,
    store: log,
    clock: fakeClock(),
    random: fakeRandom(),
    onError: () => undefined,
    ...(options.withLog === false
      ? {}
      : {
          readLog: async function* () {
            await Promise.resolve();
            yield [...log.entries].reverse();
          },
        }),
  });
  return {
    engine,
    log,
    host: fakeConnection(T.host, { isHost: true }),
    alice: fakeConnection(T.alice),
    watcher: { ...fakeConnection(T.carol), isSpectator: true },
  };
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

async function ready(options?: { withLog?: boolean }) {
  const s = setup(options);
  await s.engine.onConnect(s.host);
  await s.engine.onConnect(s.alice);
  await s.engine.onConnect(s.watcher);
  return s;
}

const rename = (name: string) => ({ sceneId: T.scene, name });
const move = (entityId: string, x: number) => ({
  sceneId: T.scene,
  entityId,
  to: { x, y: 0, z: 0 },
});
const newEntity = (id: string, name: string, layer: 'tokens' | 'dm' = 'tokens') => ({
  sceneId: T.scene,
  entity: {
    id,
    layer,
    name,
    owners: [],
    transform: {
      position: { x: 1, y: 0, z: 1 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    },
  },
});
const sceneName = (engine: ReturnType<typeof setup>['engine']) =>
  engine.state().scenes[T.scene]?.name;
const x = (engine: ReturnType<typeof setup>['engine'], entityId = T.token) =>
  engine.state().scenes[T.scene]?.entities[entityId]?.transform.position.x;

describe('history.rollback', () => {
  it('returns scenes to the target point and logs one more action without touching the log', async () => {
    const { engine, log, host } = await ready();
    expect((await send(engine, host, 'scene.rename', rename('A'))).t).toBe('ack'); // 1
    expect((await send(engine, host, 'token.move', move(T.token, 3))).t).toBe('ack'); // 2
    expect((await send(engine, host, 'scene.rename', rename('B'))).t).toBe('ack'); // 3
    expect((await send(engine, host, 'entity.create', newEntity(FUTURE, 'Newbie'))).t).toBe('ack'); // 4
    const before = log.entries.map((entry) => JSON.stringify(entry));

    expect(await send(engine, host, 'history.rollback', { toSeq: 2 })).toMatchObject({
      t: 'ack',
      seq: 5,
    });
    expect(sceneName(engine)).toBe('A');
    expect(x(engine)).toBe(3);
    expect(engine.state().scenes[T.scene]?.entities[FUTURE]).toBeUndefined();

    // Nothing is erased: the same four lines, then the rollback.
    expect(log.entries.map((entry) => JSON.stringify(entry)).slice(0, 4)).toEqual(before);
    expect(log.entries.map((entry) => entry.envelope.type)).toEqual([
      'scene.rename',
      'token.move',
      'scene.rename',
      'entity.create',
      'history.rollback',
    ]);
    expect(engine.seq()).toBe(5);
  });

  it('replays from the log to the same state', async () => {
    const { engine, log, host } = await ready();
    await send(engine, host, 'scene.rename', rename('A'));
    await send(engine, host, 'token.move', move(T.token, 3));
    await send(engine, host, 'entity.create', newEntity(FUTURE, 'Newbie'));
    await send(engine, host, 'history.rollback', { toSeq: 2 });
    let replayed: Campaign = campaign();
    for (const entry of log.entries) replayed = reduceAction(replayed, entry.envelope).state;
    expect(replayed).toEqual(engine.state());
  });

  it('keeps seats, brings back a deleted scene, and keeps the active scene valid', async () => {
    const { engine, host } = await ready();
    await send(engine, host, 'scene.create', { sceneId: SECOND_SCENE, name: 'Second' }); // 1
    await send(engine, host, 'scene.delete', { sceneId: SECOND_SCENE }); // 2
    await send(engine, host, 'seat.create', { seatId: NEW_SEAT, label: 'Late seat' }); // 3
    expect(engine.state().scenes[SECOND_SCENE]).toBeUndefined();

    expect((await send(engine, host, 'history.rollback', { toSeq: 1 })).t).toBe('ack');
    const state = engine.state();
    expect(state.scenes[SECOND_SCENE]?.name).toBe('Second');
    expect(state.seats[NEW_SEAT]?.label).toBe('Late seat'); // people are not rolled back
    expect(state.seats[T.seatA]?.identityId).toBe(T.alice);
    expect(state.scenes[state.activeSceneId ?? '']).toBeDefined();
  });

  it('can be rolled back over, returning to the state before it', async () => {
    const { engine, host } = await ready();
    await send(engine, host, 'token.move', move(T.token, 1)); // 1
    await send(engine, host, 'token.move', move(T.token, 5)); // 2
    await send(engine, host, 'history.rollback', { toSeq: 1 }); // 3
    expect(x(engine)).toBe(1);
    expect((await send(engine, host, 'history.rollback', { toSeq: 2 })).t).toBe('ack'); // 4
    expect(x(engine)).toBe(5);
  });

  it('is host only: seats, spectators and malformed requests are refused', async () => {
    const { engine, host, alice, watcher } = await ready();
    await send(engine, host, 'token.move', move(T.token, 1));
    await send(engine, host, 'token.move', move(T.token, 2));
    expect(await send(engine, alice, 'history.rollback', { toSeq: 1 })).toMatchObject({
      t: 'reject',
      reason: 'forbidden',
    });
    expect(await send(engine, watcher, 'history.rollback', { toSeq: 1 })).toMatchObject({
      t: 'reject',
      reason: 'forbidden',
    });
    for (const bad of [{}, { toSeq: 0 }, { toSeq: 'a' }, { toSeq: 1, patches: [] }]) {
      expect(await send(engine, host, 'history.rollback', bad)).toMatchObject({
        t: 'reject',
        reason: 'invalid-payload',
      });
    }
    expect(x(engine)).toBe(2);
  });

  it('refuses points that do not exist, with one answer for each', async () => {
    const { engine, host } = await ready();
    await send(engine, host, 'token.move', move(T.token, 1));
    await send(engine, host, 'token.move', move(T.token, 2));
    for (const toSeq of [2, 3, 999]) {
      expect(await send(engine, host, 'history.rollback', { toSeq })).toMatchObject({
        t: 'reject',
        reason: 'conflict',
        detail: 'no such point',
      });
    }
    expect(engine.seq()).toBe(2);
  });

  it('refuses when the host has no log to read, and when the log has a gap', async () => {
    const none = await ready({ withLog: false });
    await send(none.engine, none.host, 'token.move', move(T.token, 1));
    await send(none.engine, none.host, 'token.move', move(T.token, 2));
    expect(await send(none.engine, none.host, 'history.rollback', { toSeq: 1 })).toMatchObject({
      t: 'reject',
      reason: 'conflict',
    });

    const gap = await ready();
    for (const at of [1, 2, 3]) await send(gap.engine, gap.host, 'token.move', move(T.token, at));
    gap.log.entries.splice(1, 1); // seq 2 vanishes from the log
    expect(await send(gap.engine, gap.host, 'history.rollback', { toSeq: 1 })).toMatchObject({
      t: 'reject',
      reason: 'conflict',
      detail: 'no such point',
    });
    expect(x(gap.engine)).toBe(3);
  });

  it('refuses a point further back than it will walk', async () => {
    const state = campaign();
    const total = ROLLBACK_MAX_ENTRIES + 2;
    const entries: LogEntry[] = [];
    for (let seq = total; seq >= 1; seq--)
      entries.push({
        envelope: {
          id: tid(50),
          type: 'scene.rename',
          payload: {},
          actor: { kind: 'host' },
          campaignId: T.campaign,
          sessionId: SESSION,
          seq,
          ts: 1,
        },
        inversePatches: [],
      });
    const plan = await planRollback({
      state,
      seq: total,
      actor: { kind: 'host' },
      request: { toSeq: 1 },
      readLog: async function* () {
        await Promise.resolve();
        yield entries;
      },
    });
    expect(plan).toMatchObject({ ok: false, reason: 'conflict' });
    expect(plan.ok ? '' : plan.detail).toContain('too far back');
  });

  it('forgets the undo journal: older actions can no longer be undone afterwards', async () => {
    const { engine, host, alice } = await ready();
    await send(engine, alice, 'token.move', move(T.token, 3)); // 1
    await send(engine, alice, 'token.move', move(T.token, 5)); // 2
    await send(engine, host, 'history.rollback', { toSeq: 1 }); // 3
    expect(await send(engine, alice, 'history.undo', {})).toMatchObject({
      t: 'reject',
      reason: 'forbidden',
    });
    expect(await send(engine, host, 'history.undo', { targetSeqs: [2] })).toMatchObject({
      t: 'reject',
      reason: 'forbidden',
    });
    expect(x(engine)).toBe(3);
  });

  it('sends players and spectators nothing hidden while the table resyncs (PERM-03)', async () => {
    const { engine, host, alice, watcher } = await ready();
    await send(engine, host, 'scene.rename', rename('A')); // 1
    await send(engine, host, 'entity.create', newEntity(FUTURE, 'FUTURE-SECRET', 'dm')); // 2
    await send(engine, host, 'token.move', move(T.secret, 9)); // 3
    alice.clear();
    watcher.clear();

    expect((await send(engine, host, 'history.rollback', { toSeq: 1 })).t).toBe('ack');
    expect(engine.state().scenes[T.scene]?.entities[FUTURE]).toBeUndefined();
    for (const viewer of [alice, watcher]) {
      const wire = viewer.wire();
      expect(wire).toContain('"seq":4');
      for (const secret of [...SECRETS, 'FUTURE-SECRET', FUTURE, T.secret, T.hiddenName])
        expect(wire).not.toContain(secret);
    }
  });
});
