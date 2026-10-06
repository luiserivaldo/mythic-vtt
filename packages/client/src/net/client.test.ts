import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION } from '@mythic/protocol';
import { createClientStore } from '../store/store.js';
import { makeCampaign, socketFactory, tid } from '../testing.js';
import { createGameClient } from './client.js';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const backoff = { baseMs: 100, maxMs: 800, factor: 2, jitter: 0 };

function setup() {
  const sockets = socketFactory();
  const store = createClientStore();
  const client = createGameClient({
    url: 'ws://test/ws',
    identity: { identityId: tid(2), identitySecret: 'secret' },
    displayName: 'Ann',
    store,
    createSocket: sockets.createSocket,
    backoff,
    random: () => 0,
    heartbeatMs: 1000,
    pongTimeoutMs: 500,
    ackTimeoutMs: 2000,
  });
  return { sockets, store, client };
}

const snapshot = (seq: number) => ({
  t: 'snapshot',
  seq,
  state: makeCampaign(),
  seatId: tid(3),
});

describe('game client against a mock host', () => {
  it('sends hello on open, then applies snapshot and patches', () => {
    const { sockets, store, client } = setup();
    client.start();
    const ws = sockets.last();
    ws.serverOpen();
    expect(ws.sent[0]).toEqual({
      t: 'hello',
      v: PROTOCOL_VERSION,
      identityId: tid(2),
      identitySecret: 'secret',
      displayName: 'Ann',
    });
    ws.serverSend(snapshot(10));
    ws.serverSend({
      t: 'patch',
      seq: 11,
      patches: [{ op: 'replace', path: ['name'], value: 'X' }],
    });
    expect(store.getState()).toMatchObject({ ready: true, seq: 11, connection: 'open' });
    expect(store.getState().campaign?.name).toBe('X');
  });

  it('runs an intent through ack, only after the snapshot', async () => {
    const { sockets, client } = setup();
    client.start();
    const ws = sockets.last();
    ws.serverOpen();
    const p = client.submitIntent('scene.rename', { name: 'A' }, tid(5));
    expect(ws.sent).toHaveLength(1); // hello only; intent waits for state
    ws.serverSend(snapshot(1));
    expect(ws.sent[1]).toMatchObject({
      t: 'intent',
      type: 'scene.rename',
      clientRef: 'c1',
      sceneId: tid(5),
    });
    ws.serverSend({ t: 'ack', clientRef: 'c1', seq: 2 });
    await expect(p).resolves.toEqual({ ok: true, seq: 2 });
  });

  it('surfaces rejects', async () => {
    const { sockets, client } = setup();
    client.start();
    const ws = sockets.last();
    ws.serverOpen();
    ws.serverSend(snapshot(1));
    const p = client.submitIntent('x', {});
    ws.serverSend({ t: 'reject', clientRef: 'c1', reason: 'invalid-payload' });
    await expect(p).resolves.toEqual({ ok: false, reason: 'invalid-payload' });
  });

  it('reconnects with backoff, resending hello with lastSeq', () => {
    const { sockets, store, client } = setup();
    client.start();
    let ws = sockets.last();
    ws.serverOpen();
    ws.serverSend(snapshot(5));
    ws.serverClose();
    expect(store.getState().connection).toBe('waiting');
    expect(store.getState().ready).toBe(false);
    expect(sockets.sockets).toHaveLength(1);
    vi.advanceTimersByTime(99);
    expect(sockets.sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets.sockets).toHaveLength(2);
    // Still failing: delay doubles (no message received, so the attempt counter is not reset).
    ws = sockets.last();
    ws.serverClose();
    vi.advanceTimersByTime(199);
    expect(sockets.sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets.sockets).toHaveLength(3);
    ws = sockets.last();
    ws.serverOpen();
    expect(ws.sent[0]).toMatchObject({ t: 'hello', lastSeq: 5 });
  });

  it('resets backoff once the host responds', () => {
    const { sockets, client } = setup();
    client.start();
    sockets.last().serverClose();
    vi.advanceTimersByTime(100);
    sockets.last().serverClose();
    vi.advanceTimersByTime(200);
    const ws = sockets.last();
    ws.serverOpen();
    ws.serverSend(snapshot(1));
    ws.serverClose();
    vi.advanceTimersByTime(100);
    expect(sockets.sockets).toHaveLength(4);
  });

  it('fails in-flight intents on drop and flushes queued ones after reconnect', async () => {
    const { sockets, client } = setup();
    client.start();
    let ws = sockets.last();
    ws.serverOpen();
    ws.serverSend(snapshot(1));
    const inflight = client.submitIntent('a', 1);
    ws.serverClose();
    await expect(inflight).resolves.toEqual({ ok: false, reason: 'connection-lost' });
    const queued = client.submitIntent('b', 2);
    vi.advanceTimersByTime(100);
    ws = sockets.last();
    ws.serverOpen();
    ws.serverSend({ t: 'patch', seq: 2, patches: [] }); // host replayed instead of snapshotting
    expect(ws.sent.at(-1)).toMatchObject({ t: 'intent', type: 'b', clientRef: 'c2' });
    ws.serverSend({ t: 'ack', clientRef: 'c2', seq: 3 });
    await expect(queued).resolves.toEqual({ ok: true, seq: 3 });
  });

  it('reconnects immediately on a seq gap', () => {
    const { sockets, store, client } = setup();
    client.start();
    const ws = sockets.last();
    ws.serverOpen();
    ws.serverSend(snapshot(1));
    ws.serverSend({ t: 'patch', seq: 5, patches: [] });
    expect(ws.closed).toBe(true);
    expect(sockets.sockets).toHaveLength(2);
    sockets.last().serverOpen();
    expect(sockets.last().sent[0]).toMatchObject({ t: 'hello', lastSeq: 1 });
    expect(store.getState().seq).toBe(1);
  });

  it('does not retry after a fatal error', () => {
    const { sockets, store, client } = setup();
    client.start();
    const ws = sockets.last();
    ws.serverOpen();
    ws.serverSend({
      t: 'error',
      code: 'protocol-mismatch',
      message: 'old',
      fatal: true,
      supportedVersion: 2,
    });
    ws.serverClose();
    vi.advanceTimersByTime(60_000);
    expect(sockets.sockets).toHaveLength(1);
    expect(store.getState().connection).toBe('failed');
    expect(store.getState().fatalError).toContain('protocol-mismatch');
  });

  it('pings, and drops a socket whose pong never arrives', () => {
    const { sockets, client } = setup();
    client.start();
    const ws = sockets.last();
    ws.serverOpen();
    vi.advanceTimersByTime(1000);
    expect(ws.sent.at(-1)).toEqual({ t: 'ping', n: 1 });
    ws.serverSend({ t: 'pong', n: 1 });
    vi.advanceTimersByTime(500);
    expect(ws.closed).toBe(false);
    vi.advanceTimersByTime(500); // next ping
    vi.advanceTimersByTime(500); // no pong
    expect(ws.closed).toBe(true);
  });

  it('stop() closes the socket and cancels retries', () => {
    const { sockets, store, client } = setup();
    client.start();
    sockets.last().serverClose();
    client.stop();
    vi.advanceTimersByTime(10_000);
    expect(sockets.sockets).toHaveLength(1);
    expect(store.getState().connection).toBe('stopped');
  });

  it('ignores malformed frames and routes ephemerals to listeners', () => {
    const { sockets, store, client } = setup();
    const seen: unknown[] = [];
    client.onEphemeral((m) => seen.push(m.data));
    client.start();
    const ws = sockets.last();
    ws.serverOpen();
    ws.onmessage?.({ data: 'not json' } as MessageEvent);
    ws.serverSend({ t: 'wat' });
    ws.serverSend({ t: 'ephemeral', channel: 'cursor', data: { x: 1 } });
    expect(seen).toEqual([{ x: 1 }]);
    expect(store.getState().connection).toBe('open');
  });
});
