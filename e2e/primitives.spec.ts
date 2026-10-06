import { expect, test } from '@playwright/test';
import { openClient, RawClient, startTable, testUlid, type Table } from './harness.js';

// M2-02 (ENV-02): a scene holding every primitive kind must mount in the default 2D mode
// without page errors.

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

test('board mounts with one of each primitive kind and no page errors', async ({ browser }) => {
  const scene = testUlid('SCENE', 1);
  await host.intent('scene.create', { sceneId: scene, name: 'Ruins' });
  await host.intent('scene.activate', { sceneId: scene });
  const kinds = ['box', 'cylinder', 'cone', 'pyramid', 'sphere', 'plane', 'wedge'] as const;
  for (const [i, kind] of kinds.entries()) {
    await host.intent('entity.create', {
      sceneId: scene,
      entity: {
        id: testUlid('PRIM', i + 1),
        layer: 'props',
        name: kind,
        owners: [],
        transform: {
          position: { x: i * 2, y: 0, z: 1 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          scale: { x: 1.5, y: 1, z: 1.5 },
        },
        shape: { kind, color: '#c0803a', walkable: kind !== 'sphere' },
      },
    });
  }

  const client = await openClient(browser, table, 'viewer');
  const errors: string[] = [];
  client.page.on('pageerror', (e) => errors.push(e.message));
  await expect(client.page.getByLabel('Scene board')).toBeVisible();
  await expect(client.page.locator('canvas')).toBeVisible();
  await client.page.waitForTimeout(500);
  expect(errors).toEqual([]);
  await client.context.close();
});
