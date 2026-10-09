import { expect, test, type Page } from '@playwright/test';
import { RawClient, seedProfile, startTable, testUlid, type Table } from './harness.js';

let table: Table;
const HOST = { identityId: testUlid('PALETTE-HOST', 1), identitySecret: 'palette-secret' };

test.beforeAll(async () => {
  table = await startTable();
});

test.afterAll(async () => {
  await table.stop();
});

function transform(x: number, y: number, z: number, scale = { x: 1, y: 1, z: 1 }) {
  return {
    position: { x, y, z },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale,
  };
}

async function cellToPixel(page: Page, x: number, z: number) {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas box');
  const zoom = Math.min(box.width / 42, box.height / 32);
  return {
    x: box.x + box.width / 2 + (x - 20) * zoom,
    y: box.y + box.height / 2 + (z - 15) * zoom,
  };
}

test('light defaults keep a populated host board readable in 2D and 3D', async ({
  browser,
}, testInfo) => {
  const sceneId = testUlid('PALETTE-SCENE', 1);
  const tokenId = testUlid('PALETTE-TOKEN', 1);
  const propId = testUlid('PALETTE-PROP', 1);
  const setup = await RawClient.connect(table, {
    name: 'palette-host',
    ...HOST,
    hostToken: table.hostToken,
  });
  await setup.waitFor('snapshot', () => setup.state !== undefined);
  await setup.intent('scene.create', { sceneId, name: 'Light palette' });
  await setup.intent('scene.activate', { sceneId });
  await setup.intent('entity.create', {
    sceneId,
    entity: {
      id: tokenId,
      layer: 'tokens',
      name: 'Scout',
      owners: [],
      transform: transform(16, 2, 14),
      token: {
        sizeCells: 1,
        heightCells: 1,
        labelVisibility: 'all',
        color: '#0e7490',
      },
    },
  });
  await setup.intent('entity.create', {
    sceneId,
    entity: {
      id: propId,
      layer: 'props',
      name: 'Stone block',
      owners: [],
      transform: transform(22, 0, 15, { x: 4, y: 3, z: 4 }),
      shape: { kind: 'box', color: '#8a6d3b', walkable: true },
    },
  });
  await setup.intent('aoe.place', {
    sceneId,
    entity: {
      id: testUlid('PALETTE-AOE', 1),
      layer: 'effects',
      name: 'Danger zone',
      owners: [],
      transform: transform(18, 0, 19),
      aoe: { kind: 'sphere', radius: 3, color: '#9f1239' },
    },
  });
  await setup.close();

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript((identity) => {
    localStorage.setItem('mythic.identity.v1', JSON.stringify(identity));
    localStorage.setItem('mythic.host', '1');
  }, HOST);
  await seedProfile(context, 'Palette host');
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(table.clientUrl);
  await expect(page.getByRole('status')).toContainText('Connected to');
  await expect(page.getByTestId('token-label')).toHaveText('Scout');
  await expect(page.getByTestId('elevation-badge')).toHaveText('+10 ft');

  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page.getByRole('button', { name: 'Stone block', exact: true }).click();
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  const from = await cellToPixel(page, 13.5, 11.5);
  const to = await cellToPixel(page, 19.5, 11.5);
  await page.getByRole('button', { name: 'Ruler' }).click();
  await page.getByLabel('Persistent').check();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId('ruler-total')).toHaveText('30 ft');
  await page.screenshot({ path: testInfo.outputPath('palette-2d.png'), fullPage: true });

  await page.getByRole('button', { name: '3D view' }).click();
  await expect(page.getByRole('button', { name: 'Reset view' })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByTestId('ruler-total')).toContainText('H 30 ft');
  await page.screenshot({ path: testInfo.outputPath('palette-3d.png'), fullPage: true });
  expect(errors).toEqual([]);
  await context.close();
});
