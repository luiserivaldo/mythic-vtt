import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { WebSocket, WebSocketServer } from 'ws';
import {
  PROTOCOL_VERSION,
  decodeClientMessage,
  encodeServerMessage,
  isSupportedVersion,
  type HelloMessage,
  type ServerMessage,
} from '@mythic/protocol';
import { noopHandler, type GatewayConnection, type GatewayHandler } from './engine-seam.js';
import { createMemoryIdentityStore, type IdentityStore } from './identity-store.js';
import { hashSecret, verifySecret } from './secrets.js';
import { createHostTokenGate, type HostTokenGate } from './host-token.js';

export const WS_PATH = '/ws';

export interface GatewayOptions {
  handler?: GatewayHandler;
  identities?: IdentityStore;
  /** Time a socket may stay open without a valid `hello`. */
  helloTimeoutMs?: number;
  /** Interval for transport-level ping to drop dead sockets; 0 disables. */
  heartbeatMs?: number;
  /** Largest accepted frame; larger frames close the socket (1009). */
  maxPayloadBytes?: number;
  /** D24: one-time host token the first host hello must present. Omit to disable host binding. */
  hostToken?: string;
}

export interface Gateway {
  readonly app: FastifyInstance;
  /** Start listening; returns the bound port. */
  listen(opts?: { port?: number; host?: string }): Promise<number>;
  close(): Promise<void>;
  connectionCount(): number;
}

// WebSocket close codes: 1008 policy violation, 1002 protocol error.
const CLOSE_POLICY = 1008;
const CLOSE_PROTOCOL = 1002;

export function createGateway(options: GatewayOptions = {}): Gateway {
  const handler = options.handler ?? noopHandler;
  const identities = options.identities ?? createMemoryIdentityStore();
  const helloTimeoutMs = options.helloTimeoutMs ?? 10_000;
  const heartbeatMs = options.heartbeatMs ?? 30_000;
  const tokenGate: HostTokenGate = createHostTokenGate(options.hostToken);

  const app = Fastify({ logger: false });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: options.maxPayloadBytes ?? 1024 * 1024,
  });
  const sockets = new Set<WebSocket>();

  app.get('/healthz', () => ({ ok: true, protocol: PROTOCOL_VERSION }));

  app.server.on('upgrade', (req, socket, head) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== WS_PATH) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      handleConnection(ws);
    });
  });

  function sendTo(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(encodeServerMessage(message));
  }

  function fail(
    ws: WebSocket,
    code: Extract<ServerMessage, { t: 'error' }>['code'],
    message: string,
    fatal: boolean,
    closeCode: number = CLOSE_POLICY,
    extra: { supportedVersion?: number } = {},
  ): void {
    sendTo(ws, { t: 'error', code, message, fatal, ...extra });
    if (fatal) ws.close(closeCode, code);
  }

  function handleConnection(ws: WebSocket): void {
    sockets.add(ws);
    let conn: GatewayConnection | undefined;
    let helloInFlight = false;
    let alive = true;

    const helloTimer = setTimeout(() => {
      if (!conn) fail(ws, 'unauthorized', 'hello timeout', true);
    }, helloTimeoutMs);
    const heartbeat =
      heartbeatMs > 0
        ? setInterval(() => {
            if (!alive) {
              ws.terminate();
              return;
            }
            alive = false;
            ws.ping();
          }, heartbeatMs)
        : undefined;
    ws.on('pong', () => {
      alive = true;
    });

    ws.on('close', () => {
      clearTimeout(helloTimer);
      if (heartbeat) clearInterval(heartbeat);
      sockets.delete(ws);
      if (conn) handler.onDisconnect(conn);
    });
    ws.on('error', () => {
      ws.terminate();
    });

    // Messages are processed one at a time per connection so intents keep their arrival order.
    let queue: Promise<void> = Promise.resolve();
    ws.on('message', (data, isBinary) => {
      queue = queue.then(() => processFrame(data, isBinary)).catch(() => undefined);
    });

    async function processFrame(data: unknown, isBinary: boolean): Promise<void> {
      if (isBinary) {
        fail(ws, 'bad-message', 'binary frames are not supported', !conn, CLOSE_PROTOCOL);
        return;
      }
      const decoded = decodeClientMessage(String(data));
      if (!decoded.ok) {
        // Detail is generic on purpose: zod messages echo client input.
        fail(ws, 'bad-message', 'invalid message', !conn, CLOSE_PROTOCOL);
        return;
      }
      const msg = decoded.message;

      if (msg.t === 'ping') {
        sendTo(ws, { t: 'pong', n: msg.n });
        return;
      }
      if (msg.t === 'hello') {
        if (conn || helloInFlight) {
          fail(ws, 'bad-message', 'already authenticated', false);
          return;
        }
        helloInFlight = true;
        try {
          conn = await authenticate(ws, msg);
          if (conn) clearTimeout(helloTimer);
        } finally {
          helloInFlight = false;
        }
        if (conn) await run(ws, () => handler.onConnect(conn as GatewayConnection));
        return;
      }
      if (!conn) {
        fail(ws, 'unauthorized', 'hello required first', true);
        return;
      }
      const c = conn;
      switch (msg.t) {
        case 'join':
          await run(ws, () => handler.onJoin(c, msg));
          return;
        case 'intent':
          await run(ws, () => handler.onIntent(c, msg));
          return;
        case 'ephemeral':
          // `from` is host-set only (protocol docs); never trust a client-supplied value.
          await run(ws, () => handler.onEphemeral(c, { ...msg, from: c.identityId }));
          return;
      }
    }

    async function authenticate(
      socket: WebSocket,
      hello: HelloMessage,
    ): Promise<GatewayConnection | undefined> {
      if (!isSupportedVersion(hello.v)) {
        fail(socket, 'protocol-mismatch', 'unsupported protocol version', true, CLOSE_POLICY, {
          supportedVersion: PROTOCOL_VERSION,
        });
        return undefined;
      }
      const candidate = await hashSecret(hello.identitySecret);
      const stored = await identities.registerIfAbsent({
        identityId: hello.identityId,
        secretHash: candidate,
        displayName: hello.displayName,
        ...(hello.avatar !== undefined ? { avatar: hello.avatar } : {}),
      });
      if (!(await verifySecret(hello.identitySecret, stored.secretHash))) {
        fail(socket, 'unauthorized', 'identity secret mismatch', true);
        return undefined;
      }
      if (hello.hostToken !== undefined) {
        // D24: identical error for wrong, reused or unconfigured tokens, so it reveals nothing.
        // consume() is synchronous, so two racing hellos cannot both win the single use.
        if (!tokenGate.consume(hello.hostToken)) {
          fail(socket, 'unauthorized', 'host token rejected', true);
          return undefined;
        }
        const bound = await identities.bindHostIfAbsent(hello.identityId);
        if (bound !== hello.identityId) {
          fail(socket, 'unauthorized', 'host token rejected', true);
          return undefined;
        }
      }
      const isHost = (await identities.getHostIdentityId()) === hello.identityId;
      await identities.update(hello.identityId, {
        displayName: hello.displayName,
        ...(hello.avatar !== undefined ? { avatar: hello.avatar } : {}),
      });
      if (socket.readyState !== WebSocket.OPEN) return undefined;
      return {
        connectionId: randomUUID(),
        identityId: hello.identityId,
        displayName: hello.displayName,
        avatar: hello.avatar,
        isHost,
        lastSeq: hello.lastSeq,
        send: (m) => {
          sendTo(socket, m);
        },
        sendRaw: (frame) => {
          if (socket.readyState === WebSocket.OPEN) socket.send(frame);
        },
        close: (code, reason) => {
          socket.close(code, reason);
        },
      };
    }
  }

  async function run(ws: WebSocket, fn: () => void | Promise<void>): Promise<void> {
    try {
      await fn();
    } catch {
      fail(ws, 'server-error', 'internal error', false);
    }
  }

  return {
    app,
    async listen({ port = 0, host = '127.0.0.1' } = {}) {
      await app.listen({ port, host });
      const addr = app.server.address();
      return typeof addr === 'object' && addr ? addr.port : port;
    },
    async close() {
      for (const ws of sockets) ws.terminate();
      wss.close();
      await app.close();
    },
    connectionCount: () => sockets.size,
  };
}
