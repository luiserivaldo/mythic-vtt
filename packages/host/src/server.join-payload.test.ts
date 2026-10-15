import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { JoinPayload } from '@mythic/protocol';
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

it('serves the join payload to an anonymous visitor over the real host (UI-JOIN-01)', async () => {
  dir = await mkdtemp(join(tmpdir(), 'mythic-join-'));
  host = await startHost(loadConfig({ MYTHIC_PORT: '0', MYTHIC_DATA_DIR: dir }));
  const response = await fetch(`http://127.0.0.1:${String(host.port)}/api/join`);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const text = await response.text();
  const payload = JoinPayload.parse(JSON.parse(text));
  expect(payload.campaign.title).toBe(host.engine.state().name);
  expect(payload.seats).toEqual([]);
  // No host binding yet, so the neutral fallback name; never an identity or the host token.
  expect(payload.host.name).toBe('Game Master');
  expect(text).not.toContain(host.hostToken);
});
