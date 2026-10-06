import { expect, test } from '@playwright/test';
import { RawClient, startTable, testUlid, type Table } from './harness.js';

// M2-07 (TOK-05): an elevated token in 3D gets a drop line and ground disc. Page errors must stay empty;
// set DROP_LINES_SHOTS=<dir> to save a screenshot for visual review.
let table: Table;
const HOST = { identityId: testUlid('HOST', 1), identitySecret: 'host-secret' };

test.beforeAll(async () => {
  table = await startTable();
});
test.afterAll(async () => {
  await table.stop();
});

const transform = (x: number, y: number, z: number, s = 1, sy = 1) => ({
  position: { x, y, z },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: s, y: sy, z: s },
});

test('elevated tokens render in 3D with drop lines and no page errors', async ({ browser }) => {
  const scene = testUlid('SCENE', 1);
  const setup = await RawClient.connect(table, {
    name: 'host',
    ...HOST,
    hostToken: table.hostToken,
  });
  await setup.waitFor('snapshot', () => setup.state !== undefined);
  await setup.intent('scene.create', { sceneId: scene, name: 'Tower' });
  await setup.intent('scene.activate', { sceneId: scene });
  await setup.intent('entity.create', {
    sceneId: scene,
    entity: {
      id: testUlid('BOX', 1),
      layer: 'props',
      name: 'Plinth',
      owners: [],
      transform: transform(20, 0, 15, 4, 2),
      shape: { kind: 'box', color: '#c0803a', walkable: true },
    },
  });
  for (const [i, [x, y]] of [
    [20, 5],
    [24, 3],
  ].entries()) {
    await setup.intent('entity.create', {
      sceneId: scene,
      entity: {
        id: testUlid('TOKEN', i + 1),
        layer: 'tokens',
        name: `Flyer ${i + 1}`,
        owners: [],
        transform: transform(x ?? 0, y ?? 0, 15),
        token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
      },
    });
  }
  await setup.close();

  const context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  await context.addInitScript((identity) => {
    localStorage.setItem('mythic.identity.v1', JSON.stringify(identity));
    localStorage.setItem('mythic.host', '1');
  }, HOST);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(table.clientUrl);
  await expect(page.locator('canvas')).toBeVisible();
  await page.getByRole('button', { name: '3D view' }).click();
  await expect(page.getByRole('button', { name: 'Reset view' })).toBeVisible();
  await page.waitForTimeout(1200);
  if (process.env.DROP_LINES_SHOTS) {
    await page.screenshot({ path: `${process.env.DROP_LINES_SHOTS}/3d.png` });
  }
  expect(errors).toEqual([]);
  await context.close();
});
