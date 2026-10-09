import { expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, decodeServerMessage, type ServerMessage } from '@mythic/protocol';
import { createGateway } from '../gateway/gateway.js';
import { createEngine } from './engine.js';
import { T, fixtureCampaign, memoryLog, tid } from './testing.js';

it('measures a real seated socket, sends RTT only to the DM, and clears it on disconnect', async () => {
  const engine = createEngine({
    campaign: fixtureCampaign(),
    sessionId: tid(20),
    store: memoryLog(),
  });
  const gateway = createGateway({
    handler: engine,
    heartbeatMs: 5000,
    hostToken: 'test-host-token',
  });
  const sockets: WebSocket[] = [];
  try {
    const port = await gateway.listen();
    const connect = async (identityId: string, isHost: boolean) => {
      const ws = new WebSocket(`ws://127.0.0.1:${String(port)}/ws`);
      sockets.push(ws);
      const received: ServerMessage[] = [];
      ws.on('message', (data: Buffer) => {
        const decoded = decodeServerMessage(data.toString());
        if (decoded.ok) received.push(decoded.message);
      });
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
      await expect.poll(() => received.some((message) => message.t === 'snapshot')).toBe(true);
      return { ws, received };
    };
    const host = await connect(T.host, true);
    const player = await connect(T.alice, false);
    const seat = () =>
      host.received
        .filter((m): m is Extract<ServerMessage, { t: 'presence' }> => m.t === 'presence')
        .at(-1)
        ?.seats.find((entry) => entry.seatId === T.seatA);
    await expect.poll(() => seat()?.latencyMs).toEqual(expect.any(Number));
    expect(seat()?.connected).toBe(true);
    expect(player.received.filter((message) => message.t === 'presence')).toEqual([]);
    const presence = host.received.filter((message) => message.t === 'presence');
    expect(JSON.stringify(presence)).not.toContain('test-secret');
    expect(JSON.stringify(presence)).not.toContain('127.0.0.1');
    await new Promise<void>((resolve) => {
      player.ws.once('close', () => {
        resolve();
      });
      player.ws.close();
    });
    await expect.poll(() => seat()).toMatchObject({ connected: false, latencyMs: null });
  } finally {
    for (const socket of sockets) socket.terminate();
    await gateway.close();
  }
});
