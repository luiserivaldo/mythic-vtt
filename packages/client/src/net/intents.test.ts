import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIntentQueue, type IntentRequest } from './intents.js';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function setup(extra: { maxQueued?: number } = {}) {
  const sent: IntentRequest[] = [];
  const changes: number[] = [];
  const q = createIntentQueue({
    send: (i) => sent.push(i),
    ackTimeoutMs: 1000,
    onChange: (n) => changes.push(n),
    ...extra,
  });
  return { q, sent, changes };
}

describe('intent queue', () => {
  it('sends immediately when connected and resolves on ack', async () => {
    const { q, sent } = setup();
    q.setConnected(true);
    const p = q.submit('token.move', { x: 1 }, 'S');
    expect(sent).toEqual([
      { clientRef: 'c1', type: 'token.move', payload: { x: 1 }, sceneId: 'S' },
    ]);
    q.handleAck('c1', 7);
    await expect(p).resolves.toEqual({ ok: true, seq: 7 });
    expect(q.pendingCount()).toBe(0);
  });

  it('resolves with the reason on reject', async () => {
    const { q } = setup();
    q.setConnected(true);
    const p = q.submit('a', {});
    q.handleReject('c1', 'forbidden', 'nope');
    await expect(p).resolves.toEqual({ ok: false, reason: 'forbidden', detail: 'nope' });
  });

  it('holds intents while disconnected and flushes in order on connect', async () => {
    const { q, sent } = setup();
    const p1 = q.submit('a', 1);
    const p2 = q.submit('b', 2);
    expect(sent).toHaveLength(0);
    q.setConnected(true);
    expect(sent.map((s) => s.type)).toEqual(['a', 'b']);
    q.handleAck('c1', 1);
    q.handleAck('c2', 2);
    await expect(Promise.all([p1, p2])).resolves.toHaveLength(2);
  });

  it('fails in-flight intents on disconnect but keeps unsent ones', async () => {
    const { q, sent } = setup();
    q.setConnected(true);
    const inflight = q.submit('a', 1);
    q.setConnected(false);
    await expect(inflight).resolves.toEqual({ ok: false, reason: 'connection-lost' });
    const waiting = q.submit('b', 2);
    q.setConnected(true);
    expect(sent.map((s) => s.type)).toEqual(['a', 'b']);
    q.handleAck('c2', 3);
    await expect(waiting).resolves.toEqual({ ok: true, seq: 3 });
  });

  it('times out when no ack arrives', async () => {
    const { q } = setup();
    q.setConnected(true);
    const p = q.submit('a', 1);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toEqual({ ok: false, reason: 'timeout' });
    expect(q.pendingCount()).toBe(0);
  });

  it('ignores a late ack after timeout and unknown refs', async () => {
    const { q } = setup();
    q.setConnected(true);
    const p = q.submit('a', 1);
    await vi.advanceTimersByTimeAsync(1000);
    q.handleAck('c1', 1);
    q.handleAck('zzz', 1);
    await expect(p).resolves.toMatchObject({ reason: 'timeout' });
  });

  it('bounds the offline queue', async () => {
    const { q } = setup({ maxQueued: 1 });
    void q.submit('a', 1);
    await expect(q.submit('b', 2)).resolves.toEqual({ ok: false, reason: 'queue-full' });
  });

  it('reports pending counts', () => {
    const { q, changes } = setup();
    q.setConnected(true);
    void q.submit('a', 1);
    q.handleAck('c1', 1);
    expect(changes).toEqual([1, 0]);
  });
});
