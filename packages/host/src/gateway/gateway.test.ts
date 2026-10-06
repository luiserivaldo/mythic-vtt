import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '@mythic/protocol';
import { createGateway, WS_PATH, type Gateway } from './gateway.js';
import type { GatewayConnection, GatewayHandler } from './engine-seam.js';

const ID_A = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const ID_B = '01ARZ3NDEKTSV4RRFFQ69G5FAW';

const hello = (over: Partial<Extract<ClientMessage, { t: 'hello' }>> = {}): ClientMessage => ({
  t: 'hello',
  v: PROTOCOL_VERSION,
  identityId: ID_A,
  identitySecret: 'secret-one',
  displayName: 'Ana',
  ...over,
});

interface Client {
  ws: WebSocket;
  received: ServerMessage[];
  next(): Promise<ServerMessage>;
  closed: Promise<number>;
  send(m: unknown): void;
}

let gw: Gateway;
let port: number;
const open: WebSocket[] = [];

async function start(handler?: GatewayHandler, opts: { helloTimeoutMs?: number } = {}) {
  gw = createGateway({ ...(handler ? { handler } : {}), ...opts, heartbeatMs: 0 });
  port = await gw.listen();
}

async function connect(path = WS_PATH): Promise<Client> {
  const ws = new WebSocket(`ws://127.0.0.1:${String(port)}${path}`);
  open.push(ws);
  const received: ServerMessage[] = [];
  const waiters: ((m: ServerMessage) => void)[] = [];
  ws.on('message', (d: Buffer) => {
    const m = JSON.parse(d.toString()) as ServerMessage;
    const w = waiters.shift();
    if (w) w(m);
    else received.push(m);
  });
  const closed = new Promise<number>((res) =>
    ws.on('close', (c) => {
      res(c);
    }),
  );
  await new Promise<void>((res, rej) => {
    ws.on('open', () => {
      res();
    });
    ws.on('error', rej);
  });
  return {
    ws,
    received,
    closed,
    send: (m) => {
      ws.send(typeof m === 'string' ? m : JSON.stringify(m));
    },
    next: () =>
      new Promise((res) => {
        const m = received.shift();
        if (m) res(m);
        else waiters.push(res);
      }),
  };
}

function recorder() {
  const events: string[] = [];
  const conns: GatewayConnection[] = [];
  const handler: GatewayHandler = {
    onConnect: (c) => {
      conns.push(c);
      events.push(`connect:${c.identityId}`);
    },
    onJoin: (_c, m) => void events.push(`join:${m.seatId ?? 'spectator'}`),
    onIntent: (c, m) => {
      events.push(`intent:${m.type}`);
      c.send({ t: 'ack', clientRef: m.clientRef, seq: 1 });
    },
    onEphemeral: (_c, m) => void events.push(`eph:${m.channel}:${m.from ?? ''}`),
    onDisconnect: (c) => void events.push(`disconnect:${c.identityId}`),
  };
  return { events, conns, handler };
}

afterEach(async () => {
  for (const ws of open.splice(0)) ws.terminate();
  await gw.close();
});

describe('gateway', () => {
  it('serves healthz and rejects non-ws upgrade paths', async () => {
    await start();
    const res = await fetch(`http://127.0.0.1:${String(port)}/healthz`);
    expect(await res.json()).toEqual({ ok: true, protocol: PROTOCOL_VERSION });
    await expect(connect('/nope')).rejects.toBeDefined();
  });

  it('answers ping with pong before and after hello', async () => {
    await start();
    const c = await connect();
    c.send({ t: 'ping', n: 7 });
    expect(await c.next()).toEqual({ t: 'pong', n: 7 });
    c.send(hello());
    c.send({ t: 'ping', n: 8 });
    expect(await c.next()).toEqual({ t: 'pong', n: 8 });
  });

  it('authenticates a new identity and notifies the engine', async () => {
    const r = recorder();
    await start(r.handler);
    const c = await connect();
    c.send(hello({ lastSeq: 5 }));
    c.send({ t: 'intent', type: 'x.y', payload: {}, clientRef: 'r1' });
    expect(await c.next()).toEqual({ t: 'ack', clientRef: 'r1', seq: 1 });
    expect(r.events).toEqual([`connect:${ID_A}`, 'intent:x.y']);
    expect(r.conns[0]?.lastSeq).toBe(5);
    c.ws.close();
    await c.closed;
    await new Promise((res) => setTimeout(res, 20));
    expect(r.events.at(-1)).toBe(`disconnect:${ID_A}`);
  });

  it('accepts a returning identity with the same secret, rejects a wrong one', async () => {
    const r = recorder();
    await start(r.handler);
    const c1 = await connect();
    c1.send(hello());
    c1.send({ t: 'ping', n: 1 });
    await c1.next();
    c1.ws.close();
    await c1.closed;

    const c2 = await connect();
    c2.send(hello({ displayName: 'Ana2' }));
    c2.send({ t: 'ping', n: 2 });
    await c2.next();
    expect(r.conns.at(-1)?.displayName).toBe('Ana2');

    const c3 = await connect();
    c3.send(hello({ identitySecret: 'stolen' }));
    expect(await c3.next()).toMatchObject({ t: 'error', code: 'unauthorized', fatal: true });
    expect(await c3.closed).toBe(1008);
    expect(r.events.filter((e) => e.startsWith('connect'))).toHaveLength(2);
  });

  it('gives the same secret to one identity only once under a race', async () => {
    const r = recorder();
    await start(r.handler);
    const [a, b] = await Promise.all([connect(), connect()]);
    a.send(hello({ identitySecret: 'first' }));
    b.send(hello({ identitySecret: 'second' }));
    a.send({ t: 'ping', n: 1 });
    b.send({ t: 'ping', n: 1 });
    const results = await Promise.all([a.next(), b.next()]);
    // Exactly one wins (gets the pong); the other is unauthorized.
    expect(results.filter((m) => m.t === 'error')).toHaveLength(1);
    expect(r.conns).toHaveLength(1);
  });

  it('rejects an unsupported protocol version with the supported one', async () => {
    await start();
    const c = await connect();
    c.send(hello({ v: PROTOCOL_VERSION + 1 }));
    expect(await c.next()).toMatchObject({
      t: 'error',
      code: 'protocol-mismatch',
      supportedVersion: PROTOCOL_VERSION,
      fatal: true,
    });
    await c.closed;
  });

  it('requires hello before anything else', async () => {
    const r = recorder();
    await start(r.handler);
    const c = await connect();
    c.send({ t: 'intent', type: 'x', payload: {}, clientRef: 'r' });
    expect(await c.next()).toMatchObject({ t: 'error', code: 'unauthorized', fatal: true });
    await c.closed;
    expect(r.events).toEqual([]);
  });

  it('closes on invalid frames before hello, tolerates them after', async () => {
    await start();
    const bad = await connect();
    bad.send('not json');
    expect(await bad.next()).toMatchObject({ t: 'error', code: 'bad-message', fatal: true });
    await bad.closed;

    const c = await connect();
    c.send(hello());
    c.send({ t: 'intent', type: '', clientRef: 'r' });
    expect(await c.next()).toMatchObject({ t: 'error', code: 'bad-message', fatal: false });
    c.send(hello());
    expect(await c.next()).toMatchObject({ t: 'error', code: 'bad-message', fatal: false });
    c.send({ t: 'ping', n: 1 });
    expect(await c.next()).toEqual({ t: 'pong', n: 1 });
  });

  it('times out connections that never say hello', async () => {
    await start(undefined, { helloTimeoutMs: 30 });
    const c = await connect();
    expect(await c.next()).toMatchObject({ code: 'unauthorized', fatal: true });
    await c.closed;
  });

  it('overwrites a client-supplied ephemeral `from` and routes join', async () => {
    const r = recorder();
    await start(r.handler);
    const c = await connect();
    c.send(hello());
    c.send({ t: 'join' });
    c.send({ t: 'ephemeral', channel: 'cursor', data: {}, from: ID_B });
    c.send({ t: 'ping', n: 1 });
    await c.next();
    expect(r.events).toEqual([`connect:${ID_A}`, 'join:spectator', `eph:cursor:${ID_A}`]);
  });

  it('reports handler failures as non-fatal server-error without leaking detail', async () => {
    const handler: GatewayHandler = {
      ...recorder().handler,
      onIntent: () => {
        throw new Error('secret internals');
      },
    };
    await start(handler);
    const c = await connect();
    c.send(hello());
    c.send({ t: 'intent', type: 'x', payload: {}, clientRef: 'r' });
    const m = await c.next();
    expect(m).toMatchObject({ t: 'error', code: 'server-error', fatal: false });
    expect(JSON.stringify(m)).not.toContain('secret internals');
  });

  it('default handler rejects intents instead of dropping them', async () => {
    await start();
    const c = await connect();
    c.send(hello());
    c.send({ t: 'intent', type: 'x', payload: {}, clientRef: 'r9' });
    expect(await c.next()).toMatchObject({ t: 'reject', clientRef: 'r9' });
  });
});
