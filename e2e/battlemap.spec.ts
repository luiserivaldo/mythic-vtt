import { expect, test } from '@playwright/test';
import { openClient, RawClient, startTable, testUlid, type Table } from './harness.js';

// M1-19 (ENV-01): a scene with a map-layer image mounts without page errors even when the image
// cannot be served, and survives the entity.update that a calibration commits.

let table: Table;
let host: RawClient;

test.beforeAll(async () => {
  table = await startTable();
  host = await RawClient.connect(table, {
    name: 'host',
    identityId: testUlid('HOST', 1),
    identitySecret: 'host-secret',
    hostToken: table.hostToken,
  });
  await host.waitFor('host snapshot', () => host.state !== undefined);
});

test.afterAll(async () => {
  await host.close();
  await table.stop();
});

test('board mounts with a map image and applies a calibration update without errors', async ({
  browser,
}) => {
  const scene = testUlid('SCENE', 1);
  const map = testUlid('MAP', 1);
  const rotation = { x: 0, y: 0, z: 0, w: 1 };
  const at = (s: number, x = 0, z = 0) => ({
    position: { x, y: 0, z },
    rotation,
    scale: { x: s, y: s, z: s },
  });
  const image = (calibrated: boolean) => ({
    asset: { source: 'local', hash: 'e'.repeat(64), kind: 'image' },
    calibrated,
  });
  await host.intent('scene.create', { sceneId: scene, name: 'Crypt' });
  await host.intent('scene.activate', { sceneId: scene });
  await host.intent('entity.create', {
    sceneId: scene,
    entity: {
      id: map,
      layer: 'map',
      name: 'Crypt map',
      owners: [],
      transform: at(20),
      image: image(false),
    },
  });

  const client = await openClient(browser, table, 'viewer');
  const errors: string[] = [];
  client.page.on('pageerror', (e) => errors.push(e.message));
  await expect(client.page.getByLabel('Scene board')).toBeVisible();
  await expect(client.page.locator('canvas')).toBeVisible();

  const reply = await host.intent('entity.update', {
    sceneId: scene,
    entityId: map,
    changes: { transform: at(4, 1, 2), image: image(true) },
  });
  expect(reply, JSON.stringify(reply)).toMatchObject({ t: 'ack' });
  await client.page.waitForTimeout(500);
  await expect(client.page.locator('canvas')).toBeVisible();
  expect(errors).toEqual([]);
  await client.context.close();
});
