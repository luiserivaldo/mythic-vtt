import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { loadConfig } from '../config.js';
import { startHost, type RunningHost } from '../server.js';

let dir: string;
let host: RunningHost | undefined;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mythic-static-'));
  await mkdir(join(dir, 'client/static'), { recursive: true });
  await writeFile(join(dir, 'client/index.html'), '<!doctype html><title>app</title>');
  await writeFile(join(dir, 'client/static/app.js'), 'console.log(1)');
  await writeFile(join(dir, 'secret.txt'), 'nope');
  host = await startHost(
    loadConfig({
      MYTHIC_PORT: '0',
      MYTHIC_DATA_DIR: join(dir, 'data'),
      MYTHIC_CLIENT_DIR: join(dir, 'client'),
    }),
  );
});
afterEach(async () => {
  await host?.close();
  host = undefined;
  await rm(dir, { recursive: true, force: true });
});

const url = (p: string) => `http://127.0.0.1:${String(host?.port)}${p}`;

describe('static client on the host port (HOST-01)', () => {
  it('serves index.html, bundle files and SPA fallback', async () => {
    const root = await fetch(url('/'));
    expect(root.headers.get('content-type')).toContain('text/html');
    expect(await root.text()).toContain('<title>app</title>');
    const js = await fetch(url('/static/app.js'));
    expect(js.headers.get('content-type')).toContain('javascript');
    const spa = await fetch(url('/some/route?x=1'));
    expect(spa.status).toBe(200);
    expect(await spa.text()).toContain('<title>app</title>');
  });

  it('does not shadow host routes or fall back for files and reserved paths', async () => {
    expect((await fetch(url('/healthz'))).headers.get('content-type')).toContain('json');
    expect((await fetch(url('/assets/' + 'a'.repeat(64)))).status).toBe(404);
    expect((await fetch(url('/assets/anything'))).headers.get('content-type')).not.toContain(
      'html',
    );
    expect((await fetch(url('/missing.js'))).status).toBe(404);
    expect((await fetch(url('/ws'))).headers.get('content-type') ?? '').not.toContain('html');
    expect((await fetch(url('/%2e%2e/secret.txt'))).status).not.toBe(200);
    expect(await (await fetch(url('/..%2fsecret.txt'))).text()).not.toContain('nope');
  });

  it('accepts a websocket upgrade on /ws on the same port', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${String(host?.port)}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    ws.close();
  });
});
