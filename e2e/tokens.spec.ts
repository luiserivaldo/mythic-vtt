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

// M2-06: in 3D (?camera=3d until the toggle exists) tokens render as upright standees with an
// HTML label, with and without an image, and orbiting never raises page errors.
test('3D mode mounts tokens as standees with labels and survives orbiting', async ({ browser }) => {
  const scene = testUlid('SCENE', 2);
  const one = { x: 1, y: 1, z: 1 };
  await host.intent('scene.create', { sceneId: scene, name: 'Tower' });
  await host.intent('scene.activate', { sceneId: scene });
  const make = (n: number, name: string, y: number, image: boolean) =>
    host.intent('entity.create', {
      sceneId: scene,
      entity: {
        id: testUlid('TOKEN', n),
        layer: 'tokens',
        name,
        owners: [],
        transform: {
          position: { x: n, y, z: 2 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          scale: one,
        },
        token: {
          sizeCells: n,
          heightCells: 1,
          labelVisibility: 'all',
          ...(image ? { image: { source: 'local', hash: 'd'.repeat(64), kind: 'image' } } : {}),
        },
      },
    });
  await make(1, 'Archer', 0, false);
  await make(2, 'Ogre', 3, true);

  const client = await openClient(browser, table, 'viewer');
  const errors: string[] = [];
  client.page.on('pageerror', (e) => errors.push(e.message));
  await client.page.goto(`${table.clientUrl}?camera=3d`);
  await expect(client.page.getByLabel('Scene board')).toBeVisible();
  await expect(client.page.getByTestId('token-label')).toHaveCount(2);
  const canvas = client.page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no box');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await client.page.mouse.move(cx, cy);
  await client.page.mouse.down({ button: 'right' });
  await client.page.mouse.move(cx + 200, cy + 40, { steps: 8 });
  await client.page.mouse.up({ button: 'right' });
  await client.page.mouse.click(cx, cy);
  await expect(canvas).toBeVisible();
  expect(errors).toEqual([]);
});
