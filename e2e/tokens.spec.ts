import { expect, test } from '@playwright/test';
import { openClient, RawClient, startTable, testUlid, type Table } from './harness.js';

// M1-17: the board must mount and survive an entity with a token image that the host cannot
// serve (placeholder path), and show the camera-facing HTML label (TOK-04, CAM-04).

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

test('board mounts with a token entity, showing its label and falling back when the image is missing', async ({
  browser,
}) => {
  const scene = testUlid('SCENE', 1);
  const one = { x: 1, y: 1, z: 1 };
  await host.intent('scene.create', { sceneId: scene, name: 'Crypt' });
  await host.intent('scene.activate', { sceneId: scene });
  await host.intent('entity.create', {
    sceneId: scene,
    entity: {
      id: testUlid('TOKEN', 1),
      layer: 'tokens',
      name: 'Goblin Scout',
      owners: [],
      transform: {
        position: { x: 2, y: 0, z: 3 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: one,
      },
      token: {
        sizeCells: 2,
        heightCells: 1,
        labelVisibility: 'all',
        image: { source: 'local', hash: 'c'.repeat(64), kind: 'image' },
      },
    },
  });

  const client = await openClient(browser, table, 'viewer');
  const errors: string[] = [];
  client.page.on('pageerror', (e) => errors.push(e.message));
  await expect(client.page.getByLabel('Scene board')).toBeVisible();
  await expect(client.page.getByTestId('token-label')).toHaveText('Goblin Scout');
  await expect(client.page.locator('canvas')).toBeVisible();
  expect(errors).toEqual([]);
  await client.context.close();
});
