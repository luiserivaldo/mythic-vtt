import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { DEFAULT_MAX_IMAGE_UPLOAD_BYTES, loadConfig } from './config.js';
import { startHost, type RunningHost } from './server.js';

let dir: string | undefined;
let host: RunningHost | undefined;

afterEach(async () => {
  await host?.close();
  host = undefined;
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

it('loadConfig applies defaults and env overrides', () => {
  const d = loadConfig({});
  expect(d.port).toBe(8787);
  expect(d.host).toBe('127.0.0.1');
  expect(d.hostSecretPath).toBe(join(d.dataDir, 'host-secret'));
  expect(d.maxImageUploadBytes).toBe(DEFAULT_MAX_IMAGE_UPLOAD_BYTES);
  expect(d.testEndpoints).toBe(false);
  const c = loadConfig({
    MYTHIC_PORT: '0',
    MYTHIC_DATA_DIR: '/x/y',
    MYTHIC_MAX_IMAGE_UPLOAD_BYTES: '1234',
    MYTHIC_TEST_ENDPOINTS: '1',
  });
  expect(c).toMatchObject({
    port: 0,
    dataDir: '/x/y',
    maxImageUploadBytes: 1234,
    testEndpoints: true,
  });
  expect(() => loadConfig({ MYTHIC_PORT: 'abc' })).toThrow();
  expect(() => loadConfig({ MYTHIC_MAX_IMAGE_UPLOAD_BYTES: '0' })).toThrow();
});

it('startHost creates the host secret and serves /healthz', async () => {
  dir = await mkdtemp(join(tmpdir(), 'mythic-host-'));
  host = await startHost(loadConfig({ MYTHIC_PORT: '0', MYTHIC_DATA_DIR: dir }));
  expect((await readFile(join(dir, 'host-secret'), 'utf8')).trim()).toHaveLength(64);
  const res = await fetch(`http://127.0.0.1:${String(host.port)}/healthz`);
  expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  const upload = await fetch(`http://127.0.0.1:${String(host.port)}/assets/images`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: Buffer.from('unauthenticated'),
  });
  expect(upload.status).toBe(401);
  expect((await fetch(`http://127.0.0.1:${String(host.port)}/__test/connections`)).status).toBe(
    404,
  );
});
