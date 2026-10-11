import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from '@mythic/protocol';
import { storeMigrate } from '@mythic/shared';
import { loadConfig, type HostConfig } from '../config.js';
import { T, fixtureCampaign, tid } from '../engine/testing.js';
import { startHost, type RunningHost } from '../server.js';
import { CampaignFile, LocalCampaignStore } from '../storage/index.js';
import { createHttpAuthenticator, parseCredential } from './http-auth.js';

const HOST_ID = tid(21);
const CODM_ID = tid(24);
const PLAYER_ID = T.alice; // seated as a player by the fixture
const SPECTATOR_ID = tid(25);
const UNKNOWN_ID = tid(26);
const secretOf = (id: string) => `secret-${id}`;
const header = (id: string, secret = secretOf(id)) => ({ authorization: `Mythic ${id}.${secret}` });

let dir: string;
let config: HostConfig;
let host: RunningHost;
let base: string;
const sockets: WebSocket[] = [];

/** Registering an identity happens through the real `hello`, exactly as in production. */
async function register(identityId: string, hostToken?: string): Promise<void> {
  const ws = new WebSocket(`ws://127.0.0.1:${String(host.port)}/ws`);
  sockets.push(ws);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => {
      resolve();
    });
    ws.once('error', reject);
  });
  const reply = new Promise<void>((resolve) => {
    ws.once('message', () => {
      resolve();
    });
  });
  ws.send(
    JSON.stringify({
      t: 'hello',
      v: PROTOCOL_VERSION,
      identityId,
      identitySecret: secretOf(identityId),
      displayName: 'Tester',
      ...(hostToken ? { hostToken } : {}),
    }),
  );
  await reply;
}

async function closeSockets(): Promise<void> {
  await Promise.all(
    sockets.splice(0).map(
      (ws) =>
        new Promise<void>((resolve) => {
          if (ws.readyState === WebSocket.CLOSED) {
            resolve();
            return;
          }
          ws.once('close', () => {
            resolve();
          });
          ws.close();
        }),
    ),
  );
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mythic-httpauth-'));
  config = loadConfig({ MYTHIC_PORT: '0', MYTHIC_DATA_DIR: dir });
  const campaign = fixtureCampaign();
  const co = campaign.seats[T.coDm];
  if (co) co.identityId = CODM_ID;
  const store = new LocalCampaignStore(dir, storeMigrate);
  await store.saveCampaign(campaign.id, CampaignFile.parse(campaign));
  for (const scene of Object.values(campaign.scenes)) await store.saveScene(campaign.id, scene);
  await store.close();
  host = await startHost(config, { hostToken: 'test-host-token' });
  base = `http://127.0.0.1:${String(host.port)}`;
  await register(HOST_ID, 'test-host-token');
  for (const id of [CODM_ID, PLAYER_ID, SPECTATOR_ID]) await register(id);
});
afterEach(async () => {
  await closeSockets();
  await host.close();
  await rm(dir, { recursive: true, force: true });
});

const png = () =>
  sharp({ create: { width: 8, height: 8, channels: 3, background: '#336699' } })
    .png()
    .toBuffer();
const upload = async (headers: Record<string, string>) =>
  fetch(`${base}/assets/images`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', ...headers },
    body: new Uint8Array(await png()),
  });

describe('parseCredential', () => {
  it('accepts the Mythic scheme and rejects malformed values', () => {
    expect(parseCredential(`Mythic ${HOST_ID}.abc123`)).toEqual({
      identityId: HOST_ID,
      secret: 'abc123',
    });
    for (const bad of [
      undefined,
      '',
      'Bearer x.y',
      `Mythic ${HOST_ID}`,
      `Mythic short.abc`,
      `Mythic ${HOST_ID}.`,
      `mythic ${HOST_ID}.abc`,
      `Mythic ${HOST_ID}.a b`,
      `Mythic ${HOST_ID}.abc extra`,
    ]) {
      expect(parseCredential(bad)).toBeNull();
    }
  });
});

describe('authentication matrix on POST /assets/images', () => {
  it('allows the host and co-DM seats', async () => {
    expect((await upload(header(HOST_ID))).status).toBe(201);
    expect((await upload(header(CODM_ID))).status).toBe(200);
  });

  it('denies players and seatless identities with 403 and a generic body', async () => {
    for (const id of [PLAYER_ID, SPECTATOR_ID]) {
      const res = await upload(header(id));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'forbidden' });
    }
  });

  it('answers 401 identically for unknown identity, wrong secret, missing and malformed headers', async () => {
    const attempts: Record<string, string>[] = [
      header(UNKNOWN_ID),
      header(HOST_ID, 'wrong-secret'),
      {},
      { authorization: 'Mythic nonsense' },
      { authorization: `Bearer ${HOST_ID}.${secretOf(HOST_ID)}` },
    ];
    const bodies = new Set<string>();
    for (const headers of attempts) {
      const res = await upload(headers);
      expect(res.status).toBe(401);
      bodies.add(await res.text());
    }
    expect(bodies.size).toBe(1);
  });

  it('never echoes the secret in error bodies', async () => {
    const res = await upload(header(HOST_ID, 'super-secret-value'));
    expect(await res.text()).not.toContain('super-secret-value');
  });

  it('rejects cross-origin browsers and sends no CORS headers', async () => {
    const res = await upload({ ...header(HOST_ID), origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    const same = await upload({ ...header(HOST_ID), origin: base });
    expect(same.status).toBe(201);
    expect(same.headers.get('access-control-allow-origin')).toBeNull();
    const preflight = await fetch(`${base}/assets/images`, { method: 'OPTIONS' });
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('throttles repeated failed attempts per client address', async () => {
    let last = 0;
    for (let i = 0; i < 25; i++) last = (await upload(header(HOST_ID, 'nope'))).status;
    expect(last).toBe(429);
    // Even a correct credential waits out the lockout window.
    expect((await upload(header(HOST_ID))).status).toBe(429);
  });
});

describe('constant-time verification', () => {
  const identities = {
    get: vi.fn((id: string) =>
      Promise.resolve(
        id === HOST_ID ? { identityId: id, secretHash: 'stored', displayName: 'x' } : undefined,
      ),
    ),
    getHostIdentityId: () => Promise.resolve(HOST_ID),
    registerIfAbsent: vi.fn(),
    update: vi.fn(),
    rebindHost: vi.fn(),
  };
  const request = (id: string) =>
    ({ headers: { authorization: `Mythic ${id}.sekrit` }, ip: '1.2.3.4' }) as never;

  it('verifies through the injected scrypt check, also for unknown identities', async () => {
    const verify = vi.fn<(secret: string, stored: string) => Promise<boolean>>(() =>
      Promise.resolve(false),
    );
    const auth = createHttpAuthenticator({
      identities,
      state: () => fixtureCampaign(),
      verify,
    });
    await auth.authenticate(request(HOST_ID));
    await auth.authenticate(request(UNKNOWN_ID));
    expect(verify).toHaveBeenCalledTimes(2);
    expect(verify.mock.calls[0]).toEqual(['sekrit', 'stored']);
    expect(verify.mock.calls[1]?.[1]).toMatch(/^scrypt\$/);
  });

  it('resolves host, co-DM, player and seatless principals', async () => {
    const auth = createHttpAuthenticator({
      identities: {
        ...identities,
        get: (id: string) =>
          Promise.resolve({ identityId: id, secretHash: 'stored', displayName: 'x' }),
      },
      state: () => {
        const c = fixtureCampaign();
        const co = c.seats[T.coDm];
        if (co) co.identityId = CODM_ID;
        return c;
      },
      verify: () => Promise.resolve(true),
    });
    const role = async (id: string) => {
      const r = await auth.authenticate(request(id));
      return r.ok ? r.principal : null;
    };
    expect(await role(HOST_ID)).toMatchObject({ isHost: true, role: 'host' });
    expect(await role(CODM_ID)).toMatchObject({ isHost: false, role: 'codm', seatId: T.coDm });
    expect(await role(PLAYER_ID)).toMatchObject({ role: 'player', seatId: T.seatA });
    expect(await role(SPECTATOR_ID)).toMatchObject({ role: 'none' });
  });
});

describe('campaign export and import over HTTP', () => {
  const exportUrl = () => `${base}/api/campaigns/${host.engine.campaignId}/export`;

  it('is host only: co-DMs, players and strangers are refused', async () => {
    expect((await fetch(exportUrl())).status).toBe(401);
    for (const id of [CODM_ID, PLAYER_ID, SPECTATOR_ID]) {
      expect((await fetch(exportUrl(), { headers: header(id) })).status).toBe(403);
      const imp = await fetch(`${base}/api/campaigns/import`, {
        method: 'POST',
        headers: { ...header(id), 'content-type': 'application/zip' },
        body: new Uint8Array([1, 2, 3]),
      });
      expect(imp.status).toBe(403);
    }
  });

  it('exports a zip, and importing it again reports a conflict without overwriting', async () => {
    const res = await fetch(exportUrl(), { headers: header(HOST_ID) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    const zip = new Uint8Array(await res.arrayBuffer());
    expect(Buffer.from(zip.subarray(0, 2)).toString()).toBe('PK');

    const again = await fetch(`${base}/api/campaigns/import`, {
      method: 'POST',
      headers: { ...header(HOST_ID), 'content-type': 'application/zip' },
      body: zip,
    });
    expect(again.status).toBe(409);
  });

  it('round-trips into a fresh host data dir', async () => {
    const res = await fetch(exportUrl(), { headers: header(HOST_ID) });
    const zip = new Uint8Array(await res.arrayBuffer());
    const sourceId = host.engine.campaignId;
    await closeSockets();
    await host.close();
    await rm(dir, { recursive: true, force: true });

    dir = await mkdtemp(join(tmpdir(), 'mythic-httpauth-'));
    config = loadConfig({ MYTHIC_PORT: '0', MYTHIC_DATA_DIR: dir });
    host = await startHost(config, { hostToken: 'test-host-token' });
    base = `http://127.0.0.1:${String(host.port)}`;
    await register(HOST_ID, 'test-host-token');

    const imported = await fetch(`${base}/api/campaigns/import`, {
      method: 'POST',
      headers: { ...header(HOST_ID), 'content-type': 'application/zip' },
      body: zip,
    });
    expect(imported.status).toBe(201);
    expect(await imported.json()).toMatchObject({ campaignId: sourceId, scenes: 1 });
    const again = await fetch(`${base}/api/campaigns/${sourceId}/export`, {
      headers: header(HOST_ID),
    });
    expect(again.status).toBe(200);
  });

  it('rejects bad ids, unknown campaigns, wrong types, garbage archives and oversize bodies', async () => {
    const h = header(HOST_ID);
    expect((await fetch(`${base}/api/campaigns/bad.id/export`, { headers: h })).status).toBe(400);
    expect((await fetch(`${base}/api/campaigns/${tid(30)}/export`, { headers: h })).status).toBe(
      404,
    );
    const wrongType = await fetch(`${base}/api/campaigns/import`, {
      method: 'POST',
      headers: { ...h, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(wrongType.status).toBe(415);
    const garbage = await fetch(`${base}/api/campaigns/import`, {
      method: 'POST',
      headers: { ...h, 'content-type': 'application/zip' },
      body: new Uint8Array(64),
    });
    expect(garbage.status).toBe(400);
  });

  it('enforces the archive size limit and a per-identity rate limit', async () => {
    await closeSockets();
    await host.close();
    host = await startHost(config, {
      hostToken: 'test-host-token',
      importLimits: { maxArchiveBytes: 16 },
    });
    base = `http://127.0.0.1:${String(host.port)}`;
    await register(HOST_ID, 'test-host-token');
    const big = await fetch(`${base}/api/campaigns/import`, {
      method: 'POST',
      headers: { ...header(HOST_ID), 'content-type': 'application/zip' },
      body: new Uint8Array(1024),
    });
    expect(big.status).toBe(413);
    let last = 0;
    for (let i = 0; i < 12; i++)
      last = (await fetch(exportUrl(), { headers: header(HOST_ID) })).status;
    expect(last).toBe(429);
  });
});
