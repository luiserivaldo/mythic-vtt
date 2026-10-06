import {
  PROTOCOL_VERSION,
  decodeServerMessage,
  encodeClientMessage,
  type ClientMessage,
  type ServerMessage,
} from '@mythic/protocol';
import { DEFAULT_BACKOFF, backoffDelay, type BackoffOptions } from './backoff.js';

/** The subset of the browser WebSocket we use; tests supply a fake. */
export interface SocketLike {
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'open'
  /** Waiting out the backoff delay before the next attempt. */
  | 'waiting'
  /** A fatal host error (bad identity, protocol mismatch): we do not retry. */
  | 'failed'
  | 'stopped';

export type HelloFields = Omit<Extract<ClientMessage, { t: 'hello' }>, 't' | 'v' | 'lastSeq'>;

export interface ConnectionOptions {
  url: string;
  createSocket(url: string): SocketLike;
  /** Evaluated on every (re)connect so a changed display name is picked up. */
  hello(): HelloFields;
  /** Last applied `seq`, sent in `hello` so the host can replay or resnapshot (§7.1). */
  lastSeq(): number | undefined;
  onMessage(message: ServerMessage): void;
  onStatus(
    status: ConnectionStatus,
    detail?: { attempt?: number; delayMs?: number; error?: string },
  ): void;
  backoff?: BackoffOptions | undefined;
  random?: (() => number) | undefined;
  /** Interval between application-level pings; 0 disables. */
  heartbeatMs?: number | undefined;
  /** Close and reconnect if no pong arrives this long after a ping. */
  pongTimeoutMs?: number | undefined;
}

/** WebSocket with hello handshake, heartbeat and exponential-backoff reconnect. */
export function createConnection(options: ConnectionOptions) {
  const backoff = options.backoff ?? DEFAULT_BACKOFF;
  const random = options.random ?? Math.random;
  const heartbeatMs = options.heartbeatMs ?? 15_000;
  const pongTimeoutMs = options.pongTimeoutMs ?? 10_000;

  let status: ConnectionStatus = 'idle';
  let socket: SocketLike | undefined;
  let attempt = 0;
  let stopped = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  let pongTimer: ReturnType<typeof setTimeout> | undefined;
  let pingN = 0;
  let fatal = false;

  function setStatus(
    next: ConnectionStatus,
    detail?: Parameters<ConnectionOptions['onStatus']>[1],
  ) {
    status = next;
    options.onStatus(next, detail);
  }

  function clearHeartbeat() {
    if (pingTimer !== undefined) clearInterval(pingTimer);
    if (pongTimer !== undefined) clearTimeout(pongTimer);
    pingTimer = undefined;
    pongTimer = undefined;
  }

  function send(message: ClientMessage): boolean {
    if (!socket || status !== 'open') return false;
    socket.send(encodeClientMessage(message));
    return true;
  }

  function scheduleRetry() {
    if (stopped || fatal) return;
    const delayMs = backoffDelay(attempt, backoff, random);
    attempt += 1;
    setStatus('waiting', { attempt, delayMs });
    retryTimer = setTimeout(connect, delayMs);
  }

  function connect() {
    retryTimer = undefined;
    if (stopped) return;
    setStatus('connecting', { attempt });
    const ws = options.createSocket(options.url);
    socket = ws;

    ws.onopen = () => {
      if (socket !== ws) return;
      setStatus('open');
      const lastSeq = options.lastSeq();
      send({
        t: 'hello',
        v: PROTOCOL_VERSION,
        ...options.hello(),
        ...(lastSeq !== undefined ? { lastSeq } : {}),
      });
      if (heartbeatMs > 0) {
        pingTimer = setInterval(() => {
          if (pongTimer !== undefined) return;
          pingN += 1;
          send({ t: 'ping', n: pingN });
          pongTimer = setTimeout(() => {
            // Half-open socket: drop it; onclose drives the reconnect.
            ws.close(4000, 'pong timeout');
          }, pongTimeoutMs);
        }, heartbeatMs);
      }
    };

    ws.onmessage = (ev) => {
      if (socket !== ws || typeof ev.data !== 'string') return;
      const decoded = decodeServerMessage(ev.data);
      if (!decoded.ok) return; // Unknown frames are ignored, never fatal for the session.
      const msg = decoded.message;
      attempt = 0; // The host answered: the link is healthy again.
      if (msg.t === 'pong') {
        if (pongTimer !== undefined) clearTimeout(pongTimer);
        pongTimer = undefined;
        return;
      }
      if (msg.t === 'error' && msg.fatal) {
        fatal = true;
        setStatus('failed', { error: `${msg.code}: ${msg.message}` });
      }
      options.onMessage(msg);
    };

    ws.onclose = () => {
      if (socket !== ws) return;
      socket = undefined;
      clearHeartbeat();
      if (stopped || fatal) return;
      scheduleRetry();
    };
    ws.onerror = () => {
      // `close` always follows; reconnect logic lives there.
    };
  }

  return {
    start(): void {
      if (status !== 'idle' && status !== 'stopped') return;
      stopped = false;
      fatal = false;
      attempt = 0;
      connect();
    },
    stop(): void {
      stopped = true;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      retryTimer = undefined;
      clearHeartbeat();
      const ws = socket;
      socket = undefined;
      if (ws) ws.close(1000, 'client stopped');
      setStatus('stopped');
    },
    /** Drop the current socket and reconnect immediately (e.g. after a seq gap). */
    reconnectNow(): void {
      if (stopped || fatal) return;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      retryTimer = undefined;
      clearHeartbeat();
      const ws = socket;
      socket = undefined;
      if (ws) ws.close(4001, 'resync');
      attempt = 0;
      connect();
    },
    send,
    status: () => status,
  };
}

export type Connection = ReturnType<typeof createConnection>;
