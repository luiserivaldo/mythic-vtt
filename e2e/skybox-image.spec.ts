import { expect, test } from '@playwright/test';
import { openClient, RawClient, startTable, testUlid } from './harness.js';

// ENV-07 (M4-33): a scene's uploaded image is drawn as its 3D skybox; the colour/gradient is the
// fallback when the scene has no image or the image cannot be loaded.

// 1x1 PNG: the smallest valid upload the image pipeline accepts (see multi-campaign.spec.ts).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const imageAssetRequest = (url: string) => /\/assets\/[0-9a-f]{64}$/.test(new URL(url).pathname);

const HOST = { identityId: testUlid('HOST', 3), identitySecret: 'skybox-secret' };

async function startScene(
  table: { hostPort: number; hostToken: string },
  name: string,
  scene: string,
) {
  const host = await RawClient.connect(table, {
    name: 'host',
    ...HOST,
    hostToken: table.hostToken,
  });
  await host.waitFor('host snapshot', () => host.state !== undefined);
  await host.intent('scene.create', { sceneId: scene, name });
  await host.intent('scene.activate', { sceneId: scene });
  return host;
}

async function uploadImage(hostPort: number): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${String(hostPort)}/assets/images`, {
    method: 'POST',
    headers: {
      'content-type': 'image/png',
      authorization: `Mythic ${HOST.identityId}.${HOST.identitySecret}`,
    },
    body: PNG,
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { image: { hash: string } }).image.hash;
}

test('an uploaded image is drawn as the 3D skybox without errors', async ({ browser }) => {
  const table = await startTable();
  try {
    const scene = testUlid('SCENE', 3);
    const host = await startScene(table, 'Skybox', scene);
    const hash = await uploadImage(table.hostPort);
    // A plain colour (no zenith), so the dome only exists because of the image.
    await host.intent('scene.update', {
      sceneId: scene,
      background: '#102030',
      skybox: { source: 'local', hash, kind: 'image' },
    });

    const client = await openClient(browser, table, 'viewer');
    const errors: string[] = [];
    client.page.on('pageerror', (e) => errors.push(e.message));
    const assetStatuses: number[] = [];
    client.page.on('response', (response) => {
      if (imageAssetRequest(response.url())) assetStatuses.push(response.status());
    });
    await client.page.goto(`${table.clientUrl}?camera=3d`);
    await expect(client.page.locator('canvas')).toBeVisible();
    // The dome fetched the uploaded image rather than only drawing the gradient.
    await expect.poll(() => assetStatuses.length).toBeGreaterThan(0);
    expect(assetStatuses).not.toContain(404);
    expect(errors).toEqual([]);

    await client.context.close();
    await host.close();
  } finally {
    await table.stop();
  }
});

test('an image skybox that cannot be loaded falls back to the colour/gradient', async ({
  browser,
}) => {
  const table = await startTable();
  try {
    const scene = testUlid('SCENE', 3);
    const host = await startScene(table, 'Missing sky', scene);
    // A well-formed hash the host has never stored, so the texture request 404s.
    await host.intent('scene.update', {
      sceneId: scene,
      background: '#102030',
      zenith: '#6688aa',
      skybox: { source: 'local', hash: 'b'.repeat(64), kind: 'image' },
    });

    const client = await openClient(browser, table, 'viewer');
    const errors: string[] = [];
    client.page.on('pageerror', (e) => errors.push(e.message));
    const assetStatuses: number[] = [];
    client.page.on('response', (response) => {
      if (imageAssetRequest(response.url())) assetStatuses.push(response.status());
    });
    await client.page.goto(`${table.clientUrl}?camera=3d`);
    await expect(client.page.locator('canvas')).toBeVisible();
    await expect.poll(() => assetStatuses.length).toBeGreaterThan(0);
    expect(assetStatuses).toContain(404);
    // A failed texture must fall back quietly, not raise.
    expect(errors).toEqual([]);

    await client.context.close();
    await host.close();
  } finally {
    await table.stop();
  }
});
