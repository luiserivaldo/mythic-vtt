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
    const match = await waitForLine(host, /listening on [^\s:]+:(\d+)/, 'game host');
    const hostPort = Number(match[1]);

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
