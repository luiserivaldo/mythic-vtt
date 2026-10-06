import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { loadConfig } from './config.js';
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
  expect(d.testEndpoints).toBe(false);
  const c = loadConfig({ MYTHIC_PORT: '0', MYTHIC_DATA_DIR: '/x/y', MYTHIC_TEST_ENDPOINTS: '1' });
  expect(c).toMatchObject({ port: 0, dataDir: '/x/y', testEndpoints: true });
  expect(() => loadConfig({ MYTHIC_PORT: 'abc' })).toThrow();
  expect(d.campaignId).toBeUndefined();
  expect(loadConfig({ MYTHIC_CAMPAIGN_ID: '01ARZ3NDEKTSV4RRFFQ69G5FAV' }).campaignId).toBe(
    '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  );
});

it('startHost creates the host secret and serves /healthz', async () => {
  dir = await mkdtemp(join(tmpdir(), 'mythic-host-'));
  host = await startHost(loadConfig({ MYTHIC_PORT: '0', MYTHIC_DATA_DIR: dir }));
  expect((await readFile(join(dir, 'host-secret'), 'utf8')).trim()).toHaveLength(64);
  const res = await fetch(`http://127.0.0.1:${String(host.port)}/healthz`);
  expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  expect((await fetch(`http://127.0.0.1:${String(host.port)}/__test/connections`)).status).toBe(
    404,
  );
});

it('startHost mints a random token per process and honours an injected one', async () => {
  dir = await mkdtemp(join(tmpdir(), 'mythic-host-'));
  const config = loadConfig({ MYTHIC_PORT: '0', MYTHIC_DATA_DIR: dir });
  host = await startHost(config);
  expect(host.hostToken.length).toBeGreaterThanOrEqual(32);
  const first = host.hostToken;
  await host.close();
  host = await startHost(config, { hostToken: 'fixed' });
  expect(host.hostToken).toBe('fixed');
  expect(first).not.toBe('fixed');
});
