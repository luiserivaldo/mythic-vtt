import { expect, test } from '@playwright/test';
import { openClient, RawClient, startTable, testUlid, type Table } from './harness.js';

// M2-04: the 3D orbit camera is opt-in (?camera=3d) until the toggle lands in M2-05. It must mount,
// respond to right-drag orbit, wheel dolly and shift-drag pan, and reset, without runtime errors.

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
  const scene = testUlid('SCENE', 1);
  await host.intent('scene.create', { sceneId: scene, name: 'Orbit' });
  await host.intent('scene.activate', { sceneId: scene });
});

test.afterAll(async () => {
  await host.close();
  await table.stop();
});

test('2D remains the default and has no reset-view control', async ({ browser }) => {
  const client = await openClient(browser, table, 'viewer');
  await expect(client.page.getByLabel('Scene board')).toBeVisible();
  await expect(client.page.getByRole('button', { name: 'Reset view' })).toHaveCount(0);
});

test('3D orbit camera orbits, dollies, pans and resets without errors', async ({ browser }) => {
  const client = await openClient(browser, table, 'viewer');
  const errors: string[] = [];
  client.page.on('pageerror', (e) => errors.push(e.message));
  await client.page.goto(`${table.clientUrl}?camera=3d`);
  const board = client.page.getByLabel('Scene board');
  await expect(board).toBeVisible();
  await expect(client.page.getByRole('button', { name: 'Reset view' })).toBeVisible();
  const canvas = client.page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no box');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await client.page.mouse.move(cx, cy);
  await client.page.mouse.down({ button: 'right' });
  await client.page.mouse.move(cx + 120, cy + 80, { steps: 6 });
  await client.page.mouse.up({ button: 'right' });
  await client.page.mouse.wheel(0, 300);
  await client.page.keyboard.down('Shift');
  await client.page.mouse.down({ button: 'middle' });
  await client.page.mouse.move(cx - 60, cy + 30, { steps: 4 });
  await client.page.mouse.up({ button: 'middle' });
  await client.page.keyboard.up('Shift');
  await client.page.getByRole('button', { name: 'Reset view' }).click();
  await expect(canvas).toBeVisible();
  expect(errors).toEqual([]);
});

// M2-09: a scene with a zenith colour mounts the gradient dome in 3D and orbiting stays error-free.
test('3D gradient skybox renders and orbits without errors', async ({ browser }) => {
  const scene = testUlid('SCENE', 1);
  await host.intent('scene.update', { sceneId: scene, background: '#102030', zenith: '#6688aa' });
  const client = await openClient(browser, table, 'viewer');
  const errors: string[] = [];
  client.page.on('pageerror', (e) => errors.push(e.message));
  await client.page.goto(`${table.clientUrl}?camera=3d`);
  const canvas = client.page.locator('canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no box');
  await client.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await client.page.mouse.down({ button: 'right' });
  await client.page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 - 60, {
    steps: 5,
  });
  await client.page.mouse.up({ button: 'right' });
  await expect(canvas).toBeVisible();
  expect(errors).toEqual([]);
});
