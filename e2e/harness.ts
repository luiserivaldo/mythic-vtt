import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, BrowserContext, Page } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STARTUP_TIMEOUT_MS = 20_000;

/** A running game host (own temp data dir) plus the client dev server proxied to it. */
export interface Table {
  readonly hostPort: number;
  readonly clientUrl: string;
  readonly dataDir: string;
  /**
   * D24 one-time host token from the host's `DM link:` line. Single use: exactly one connection
   * (the first `hello` carrying it) becomes the host.
   */
  readonly hostToken: string;
  /** Connections the host currently holds: `open` sockets and those past `hello`. */
  connections(): Promise<{ open: number; authenticated: number }>;
  stop(): Promise<void>;
}

export interface Client {
  readonly name: string;
  readonly context: BrowserContext;
  readonly page: Page;
}

export interface OpenTable {
  table: Table;
  /** The DM/host seat's browser. Seats arrive in M1; until then it is a normal client. */
  dm: Client;
  players: Client[];
  close(): Promise<void>;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => {
        resolve(port);
      });
    });
  });
}

function waitForLine(
  child: ChildProcess,
  pattern: RegExp,
  what: string,
): Promise<RegExpMatchArray> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      reject(new Error(`${what} did not start in time. Output:\n${buffer}`));
    }, STARTUP_TIMEOUT_MS);
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      const m = pattern.exec(buffer);
      if (m) {
        clearTimeout(timer);
        resolve(m);
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`${what} exited early (code ${String(code)}). Output:\n${buffer}`));
    });
  });
}

function killChild(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once('exit', () => {
      resolve();
    });
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 3000).unref();
  });
}

/**
 * Starts a fresh host on a free port with a temporary data dir, then the Vite client pointed at
 * it. Needs `pnpm build` first: the host runs from `packages/host/dist`.
 */
export async function startTable(): Promise<Table> {
  const dataDir = await mkdtemp(join(tmpdir(), 'mythic-e2e-'));
  const children: ChildProcess[] = [];
  const stop = async () => {
    await Promise.all(children.map(killChild));
    await rm(dataDir, { recursive: true, force: true });
  };
  try {
    const host = spawn('node', ['dist/main.js'], {
      cwd: join(ROOT, 'packages/host'),
      env: {
        ...process.env,
        MYTHIC_PORT: '0',
        MYTHIC_DATA_DIR: dataDir,
        MYTHIC_TEST_ENDPOINTS: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(host);
    const match = await waitForLine(
      host,
      /listening on [^\s:]+:(\d+)[\s\S]*DM link: \S+#host=([\w-]+)/,
      'game host',
    );
    const hostPort = Number(match[1]);
    const hostToken = match[2] ?? '';

    const clientPort = await freePort();
    const vite = spawn(
      join(ROOT, 'packages/client/node_modules/.bin/vite'),
      ['--port', String(clientPort), '--strictPort', '--host', '127.0.0.1'],
      {
        cwd: join(ROOT, 'packages/client'),
        env: { ...process.env, MYTHIC_PORT: String(hostPort), NO_COLOR: '1', FORCE_COLOR: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    children.push(vite);
    await waitForLine(vite, /127\.0\.0\.1:\d+/, 'client dev server');

    return {
      hostPort,
      clientUrl: `http://127.0.0.1:${String(clientPort)}`,
      dataDir,
      hostToken,
      async connections() {
        const res = await fetch(`http://127.0.0.1:${String(hostPort)}/__test/connections`);
        return (await res.json()) as { open: number; authenticated: number };
      },
      stop,
    };
  } catch (err) {
    await stop();
    throw err;
  }
}

/** One isolated browser context (own localStorage, so its own identity) on the client. */
export async function openClient(browser: Browser, table: Table, name: string): Promise<Client> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(table.clientUrl);
  return { name, context, page };
}

/** Starts a table and opens a DM context plus `playerCount` player contexts. */
export async function openTable(browser: Browser, playerCount: number): Promise<OpenTable> {
  const table = await startTable();
  const clients: Client[] = [];
  try {
    const dm = await openClient(browser, table, 'dm');
    clients.push(dm);
    const players: Client[] = [];
    for (let i = 1; i <= playerCount; i++) {
      const p = await openClient(browser, table, `player-${String(i)}`);
      clients.push(p);
      players.push(p);
    }
    return {
      table,
      dm,
      players,
      async close() {
        await Promise.all(clients.map((c) => c.context.close()));
        await table.stop();
      },
    };
  } catch (err) {
    await Promise.all(clients.map((c) => c.context.close()));
    await table.stop();
    throw err;
  }
}

/**
 * Records every raw WebSocket text frame a browser page receives (transport level, before the app
 * parses anything), for non-leak checks (PERM-03). Call before `page.goto`.
 */
export function recordPageFrames(page: Page): string[] {
  const frames: string[] = [];
  page.on('websocket', (ws) => {
    ws.on('framereceived', (e) => {
      frames.push(typeof e.payload === 'string' ? e.payload : e.payload.toString('utf8'));
    });
  });
  return frames;
}

// ---------- raw protocol clients (no browser) ----------

export interface RawClientOptions {
  name: string;
  /** ULID. Reuse the same id and secret to reconnect as the same identity. */
  identityId: string;
  identitySecret: string;
  hostToken?: string;
  lastSeq?: number;
  /** State kept from the previous connection; replayed patches apply on top of it. */
  initialState?: unknown;
}

export interface Reply {
  t: 'ack' | 'reject';
  clientRef: string;
  seq?: number;
  reason?: string;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A ULID-shaped id (26 Crockford chars) from a counter, unique per `prefix`. Test data only. */
export function testUlid(prefix: string, n: number): string {
  const tail = String(n).padStart(4, '0');
  const body = (prefix.toUpperCase().replace(/[^0-9A-Z]/g, '') + 'ZZZZZZZZZZZZZZZZZZZZZZ')
    .replace(/[ILOU]/g, 'Z')
    .slice(0, 22);
  const id = body + tail.replace(/[^0-9]/g, '0');
  if (id.length !== 26 || id.split('').some((c) => !CROCKFORD.includes(c))) {
    throw new Error(`bad test ulid ${id}`);
  }
  return id;
}

/** A WebSocket speaking the wire protocol directly, keeping every raw frame it receives. */
export class RawClient {
  /** Every text frame received, in order (transport level, unparsed). */
  readonly frames: string[] = [];
  /** Highest `seq` seen in a snapshot or patch. */
  lastSeq = -1;
  /** Local mirror of the filtered state this client was sent (snapshot + applied patches). */
  state: unknown = undefined;
  private readonly ws: WebSocket;
  private readonly replies = new Map<string, (r: Reply) => void>();
  private refs = 0;
  private waiters: (() => void)[] = [];

  private constructor(
    readonly opts: RawClientOptions,
    ws: WebSocket,
  ) {
    this.ws = ws;
    this.state = opts.initialState;
    ws.addEventListener('message', (ev) => {
      const raw = typeof ev.data === 'string' ? ev.data : String(ev.data);
      this.frames.push(raw);
      this.onFrame(raw);
      const ws2 = this.waiters;
      this.waiters = [];
      for (const w of ws2) w();
    });
  }

  static async connect(table: Table, opts: RawClientOptions): Promise<RawClient> {
    const ws = new WebSocket(`ws://127.0.0.1:${String(table.hostPort)}/ws`);
    const client = new RawClient(opts, ws);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => {
        resolve();
      });
      ws.addEventListener('error', () => {
        reject(new Error(`${opts.name}: websocket failed to open`));
      });
    });
    ws.send(
      JSON.stringify({
        t: 'hello',
        v: 1,
        identityId: opts.identityId,
        identitySecret: opts.identitySecret,
        displayName: opts.name,
        ...(opts.hostToken !== undefined ? { hostToken: opts.hostToken } : {}),
        ...(opts.lastSeq !== undefined ? { lastSeq: opts.lastSeq } : {}),
      }),
    );
    return client;
  }

  private onFrame(raw: string): void {
    const m = JSON.parse(raw) as {
      t: string;
      seq?: number;
      state?: unknown;
      patches?: { op: string; path: (string | number)[]; value?: unknown }[];
      clientRef?: string;
      reason?: string;
    };
    if (m.t === 'snapshot') {
      this.state = m.state;
      this.lastSeq = m.seq ?? this.lastSeq;
    } else if (m.t === 'patch') {
      for (const p of m.patches ?? []) this.state = applyWirePatch(this.state, p);
      this.lastSeq = m.seq ?? this.lastSeq;
    }
    if ((m.t === 'ack' || m.t === 'reject') && m.clientRef !== undefined) {
      const done = this.replies.get(m.clientRef);
      this.replies.delete(m.clientRef);
      done?.({
        t: m.t,
        clientRef: m.clientRef,
        ...(m.seq !== undefined ? { seq: m.seq } : {}),
        ...(m.reason !== undefined ? { reason: m.reason } : {}),
      });
    }
  }

  /** Resolves once `predicate` holds, re-checked after every received frame (no sleeps). */
  async waitFor(what: string, predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (Date.now() > deadline) {
        throw new Error(`${this.opts.name}: timed out waiting for ${what}`);
      }
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        setTimeout(resolve, 250).unref();
      });
    }
  }

  /** Waits for the first snapshot or replayed patches to bring this client to `seq` or later. */
  async waitForSeq(seq: number): Promise<void> {
    await this.waitFor(`seq ${String(seq)}`, () => this.lastSeq >= seq);
  }

  /** Submits an intent and resolves with the host's ack or reject. */
  async intent(type: string, payload: unknown, sceneId?: string): Promise<Reply> {
    const clientRef = `${this.opts.name}-${String(++this.refs)}`;
    const reply = new Promise<Reply>((resolve) => {
      this.replies.set(clientRef, resolve);
    });
    this.ws.send(
      JSON.stringify({
        t: 'intent',
        type,
        payload,
        clientRef,
        ...(sceneId !== undefined ? { sceneId } : {}),
      }),
    );
    return reply;
  }

  join(seatId: string): void {
    this.ws.send(JSON.stringify({ t: 'join', seatId }));
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.ws.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }
      this.ws.addEventListener('close', () => {
        resolve();
      });
      this.ws.close();
    });
  }
}

/** Applies one wire patch (Immer add/remove/replace shape) to plain JSON, returning the result. */
export function applyWirePatch(
  root: unknown,
  patch: { op: string; path: (string | number)[]; value?: unknown },
): unknown {
  if (patch.path.length === 0) return patch.value;
  const clone = structuredClone(root) as Record<string | number, unknown>;
  let node = clone;
  for (const key of patch.path.slice(0, -1)) node = node[key] as Record<string | number, unknown>;
  const last = patch.path[patch.path.length - 1] as string | number;
  if (patch.op === 'remove') {
    if (Array.isArray(node)) node.splice(Number(last), 1);
    else Reflect.deleteProperty(node, last);
  } else if (Array.isArray(node) && patch.op === 'add') {
    node.splice(Number(last), 0, patch.value);
  } else {
    node[last] = patch.value;
  }
  return clone;
}
