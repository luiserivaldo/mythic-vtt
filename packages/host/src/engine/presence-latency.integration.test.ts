import { expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, decodeServerMessage, type ServerMessage } from '@mythic/protocol';
import { createGateway } from '../gateway/gateway.js';
import { createEngine } from './engine.js';
import { T, fixtureCampaign, memoryLog, tid } from './testing.js';

it('measures a real seated socket, sends RTT only to the DM, and clears it on disconnect', async () => {
  // Socket I/O stays real; RTT and the engine's publication deadline use the controlled clock.
  const engine = createEngine({
    campaign: fixtureCampaign(),
    sessionId: tid(20),
    store: memoryLog(),
  });
  const measured = new Map<string, () => void>();
  const gateway = createGateway({
    handler: {
      ...engine,
      onLatency(conn) {
        engine.onLatency?.(conn);
        measured.get(conn.identityId)?.();
      },
    },
    heartbeatMs: 5000,
    hostToken: 'test-host-token',
  });
  const sockets: WebSocket[] = [];
  try {
    const port = await gateway.listen();
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
    const connect = async (identityId: string, isHost: boolean) => {
      const ws = new WebSocket(`ws://127.0.0.1:${String(port)}/ws`, { autoPong: false });
      sockets.push(ws);
      const received: ServerMessage[] = [];
      const listeners = new Set<(message: ServerMessage) => void>();
      const nextMessage = (matches: (message: ServerMessage) => boolean) =>
        new Promise<ServerMessage>((resolve) => {
          const listener = (message: ServerMessage) => {
            if (!matches(message)) return;
            listeners.delete(listener);
            resolve(message);
          };
          listeners.add(listener);
        });
      const snapshot = nextMessage((message) => message.t === 'snapshot');
      ws.on('message', (data: Buffer) => {
        const decoded = decodeServerMessage(data.toString());
        if (!decoded.ok) return;
        received.push(decoded.message);
        for (const listener of listeners) listener(decoded.message);
      });
      const probe = new Promise<Buffer>((resolve) => ws.once('ping', resolve));
      const sample = new Promise<void>((resolve) => measured.set(identityId, resolve));
      await new Promise<void>((resolve, reject) => {
        ws.once('open', resolve);
        ws.once('error', reject);
      });
      ws.send(
        JSON.stringify({
          t: 'hello',
          v: PROTOCOL_VERSION,
          identityId,
          identitySecret: 'test-secret',
          displayName: isHost ? 'DM' : 'Alice',
          ...(isHost ? { hostToken: 'test-host-token' } : {}),
        }),
      );
      await snapshot;
      const challenge = await probe;
      // The player responds exactly 42ms later, independent of machine or network load.
      if (!isHost) await vi.advanceTimersByTimeAsync(42);
      ws.pong(challenge);
      await sample;
      return { ws, received, nextMessage };
    };
    const host = await connect(T.host, true);
    const player = await connect(T.alice, false);
    const seat = () =>
      host.received
        .filter((m): m is Extract<ServerMessage, { t: 'presence' }> => m.t === 'presence')
        .at(-1)
        ?.seats.find((entry) => entry.seatId === T.seatA);
    await vi.advanceTimersByTimeAsync(999);
    expect(seat()?.latencyMs).toBeNull();
    const update = host.nextMessage(
      (message) =>
        message.t === 'presence' && message.seats.some((entry) => entry.latencyMs === 42),
    );
    await vi.advanceTimersByTimeAsync(1);
    await update;
    expect(seat()).toMatchObject({ connected: true, latencyMs: 42 });
    expect(player.received.filter((message) => message.t === 'presence')).toEqual([]);
    const presence = host.received.filter((message) => message.t === 'presence');
    expect(JSON.stringify(presence)).not.toContain('test-secret');
    expect(JSON.stringify(presence)).not.toContain('127.0.0.1');
    const offline = host.nextMessage(
      (message) =>
        message.t === 'presence' &&
        message.seats.some(
          (entry) => entry.seatId === T.seatA && !entry.connected && entry.latencyMs === null,
        ),
    );
    player.ws.close();
    await offline;
    expect(seat()).toMatchObject({ connected: false, latencyMs: null });
  } finally {
    for (const socket of sockets) socket.terminate();
    vi.useRealTimers();
    await gateway.close();
  }
});
