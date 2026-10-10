import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '@mythic/protocol';
import { createGateway, WS_PATH, type Gateway } from './gateway.js';
import type { IdentityStore } from './identity-store.js';
import { createMemoryIdentityStore } from './identity-store.js';
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

async function start(
  handler?: GatewayHandler,
  opts: {
    helloTimeoutMs?: number;
    hostToken?: string;
    identities?: IdentityStore;
    heartbeatMs?: number;
  } = {},
) {
  gw = createGateway({ ...(handler ? { handler } : {}), heartbeatMs: 0, ...opts });
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

describe('host token (D24)', () => {
  const TOKEN = 'host-token-value';
  const ok = async (c: Client) => {
    c.send({ t: 'ping', n: 1 });
    expect(await c.next()).toEqual({ t: 'pong', n: 1 });
  };
  const rejected = async (c: Client) => {
    expect(await c.next()).toMatchObject({
      t: 'error',
      code: 'unauthorized',
      message: 'host token rejected',
      fatal: true,
    });
    await c.closed;
  };

  it('binds the identity as host with a valid token and recognises it on reconnect', async () => {
    const r = recorder();
    await start(r.handler, { hostToken: TOKEN });
    const c1 = await connect();
    c1.send(hello({ hostToken: TOKEN }));
    await ok(c1);
    expect(r.conns[0]?.isHost).toBe(true);
    c1.ws.close();
    await c1.closed;
    const c2 = await connect();
    c2.send(hello()); // own identity secret, no token
    await ok(c2);
    expect(r.conns[1]?.isHost).toBe(true);
  });

  it('treats ordinary identities as non-host', async () => {
    const r = recorder();
    await start(r.handler, { hostToken: TOKEN });
    const c = await connect();
    c.send(hello());
    await ok(c);
    expect(r.conns[0]?.isHost).toBe(false);
  });

  it('rejects a wrong token without consuming the real one', async () => {
    const r = recorder();
    await start(r.handler, { hostToken: TOKEN });
    const bad = await connect();
    bad.send(hello({ hostToken: 'nope' }));
    await rejected(bad);
    const good = await connect();
    good.send(hello({ hostToken: TOKEN }));
    await ok(good);
    expect(r.conns.at(-1)?.isHost).toBe(true);
  });

  it('rejects a reused token with the same error, and the other identity stays non-host', async () => {
    const r = recorder();
    await start(r.handler, { hostToken: TOKEN });
    const a = await connect();
    a.send(hello({ hostToken: TOKEN }));
    await ok(a);
    const b = await connect();
    b.send(hello({ identityId: ID_B, identitySecret: 'secret-two', hostToken: TOKEN }));
    await rejected(b);
    const b2 = await connect();
    b2.send(hello({ identityId: ID_B, identitySecret: 'secret-two' }));
    await ok(b2);
    expect(r.conns.at(-1)?.isHost).toBe(false);
  });

  it('rebinds host to a new identity with a fresh token; the old host loses it immediately', async () => {
    const identities = createMemoryIdentityStore();
    const r1 = recorder();
    await start(r1.handler, { hostToken: TOKEN, identities });
    const a = await connect();
    a.send(hello({ hostToken: TOKEN }));
    await ok(a);
    expect(r1.conns[0]?.isHost).toBe(true);
    await gw.close();

    // New process (new token), same persisted identities: the DM cleared storage, so new identity.
    const r2 = recorder();
    await start(r2.handler, { hostToken: 'second-token', identities });
    const b = await connect();
    b.send(hello({ identityId: ID_B, identitySecret: 'secret-two', hostToken: 'second-token' }));
    await ok(b);
    expect(r2.conns[0]?.isHost).toBe(true);
    const old = await connect();
    old.send(hello());
    await ok(old);
    expect(r2.conns[1]?.isHost).toBe(false);
    expect(await identities.getHostIdentityId()).toBe(ID_B);
    // The consumed token cannot be reused, even by the old identity to take host back.
    const again = await connect();
    again.send(hello({ hostToken: 'second-token' }));
    await rejected(again);
  });

  it('closes stale open connections of the identity that gains host, so they reconnect as host', async () => {
    const r = recorder();
    await start(r.handler, { hostToken: TOKEN });
    const tab1 = await connect();
    tab1.send(hello());
    await ok(tab1);
    expect(r.conns[0]?.isHost).toBe(false);
    const tab2 = await connect();
    tab2.send(hello({ hostToken: TOKEN }));
    await ok(tab2);
    expect(await tab1.closed).toBe(1008);
    expect(r.conns[1]?.isHost).toBe(true);
  });

  it("closes the previous host's open connection when another identity rebinds host", async () => {
    const identities = createMemoryIdentityStore();
    await identities.rebindHost(ID_A);
    const r = recorder();
    await start(r.handler, { hostToken: TOKEN, identities });
    const oldHost = await connect();
    oldHost.send(hello());
    await ok(oldHost);
    expect(r.conns[0]?.isHost).toBe(true);
    const dm = await connect();
    dm.send(hello({ identityId: ID_B, identitySecret: 'secret-two', hostToken: TOKEN }));
    await ok(dm);
    expect(await oldHost.closed).toBe(1008);
  });

  it('gives the same error when no token is configured', async () => {
    await start(undefined);
    const c = await connect();
    c.send(hello({ hostToken: TOKEN }));
    await rejected(c);
  });

  it('does not consume the token when the identity secret is wrong', async () => {
    const r = recorder();
    await start(r.handler, { hostToken: TOKEN });
    const first = await connect();
    first.send(hello());
    await ok(first);
    const attacker = await connect();
    attacker.send(hello({ identitySecret: 'wrong', hostToken: TOKEN }));
    expect(await attacker.next()).toMatchObject({ t: 'error', code: 'unauthorized' });
    await attacker.closed;
    const real = await connect();
    real.send(hello({ hostToken: TOKEN }));
    await ok(real);
    expect(r.conns.at(-1)?.isHost).toBe(true);
  });

  it('lets only one of two racing hellos win the token', async () => {
    const r = recorder();
    await start(r.handler, { hostToken: TOKEN });
    const a = await connect();
    const b = await connect();
    a.send(hello({ hostToken: TOKEN }));
    b.send(hello({ identityId: ID_B, identitySecret: 's2', hostToken: TOKEN }));
    a.send({ t: 'ping', n: 1 });
    b.send({ t: 'ping', n: 1 });
    const [ma, mb] = await Promise.all([a.next(), b.next()]);
    expect([ma, mb].filter((m) => m.t === 'error')).toHaveLength(1);
    expect([ma, mb].filter((m) => m.t === 'pong')).toHaveLength(1);
    expect(r.conns.filter((c) => c.isHost)).toHaveLength(1);
  });
});

describe('transport RTT (UX-06)', () => {
  it('measures authenticated automatic pong replies without exposing connection details', async () => {
    const r = recorder();
    const samples: number[] = [];
    await start(
      {
        ...r.handler,
        onLatency: (conn) => {
          if (conn.latencyMs !== null && conn.latencyMs !== undefined) samples.push(conn.latencyMs);
        },
      },
      { heartbeatMs: 1000 },
    );
    const c = await connect();
    c.send(hello());
    await expect.poll(() => samples.length).toBeGreaterThan(0);
    expect(samples[0]).toBeGreaterThanOrEqual(0);
    expect(samples[0]).toBeLessThanOrEqual(30_000);
    expect(c.received).toEqual([]);
  });
  it('rejects version 1 after the presence contract upgrade', async () => {
    await start();
    const c = await connect();
    c.send(hello({ v: 1 }));
    expect(await c.next()).toMatchObject({
      t: 'error',
      code: 'protocol-mismatch',
      supportedVersion: 2,
      fatal: true,
    });
    await c.closed;
  });
});
