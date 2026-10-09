import { expect, test } from '@playwright/test';
import { Campaign } from '../packages/shared/src/index.js';
import { RawClient, startTable, testUlid, type Table } from './harness.js';
let table: Table;
test.beforeAll(async () => {
  table = await startTable();
});
test.afterAll(async () => {
  await table.stop();
});
test('scene washes sync, preserve input and labels in both views, and reload', async ({
  browser,
}) => {
  const host = await RawClient.connect(table, {
    name: 'DM',
    identityId: testUlid('HOST', 1),
    identitySecret: 'filters-host',
    hostToken: table.hostToken,
  });
  const sceneId = testUlid('SCENE', 1),
    tokenId = testUlid('TOKEN', 1);
  expect(await host.intent('scene.create', { sceneId, name: 'Filters' })).toMatchObject({
    t: 'ack',
  });
  expect(await host.intent('scene.activate', { sceneId })).toMatchObject({ t: 'ack' });
  expect(
    await host.intent('entity.create', {
      sceneId,
      entity: {
        id: tokenId,
        name: 'Clear label',
        layer: 'tokens',
        owners: [],
        transform: {
          position: { x: 20, y: 0, z: 15 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          scale: { x: 1, y: 1, z: 1 },
        },
        token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
      },
    }),
  ).toMatchObject({ t: 'ack' });
  const spectator = await RawClient.connect(table, { name: 'Spectator' });
  await spectator.waitFor('snapshot', () => spectator.state !== undefined);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }),
    page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${table.clientUrl.replace(/\/$/, '')}/#host=${table.hostToken}`);
  await page.getByRole('button', { name: 'Scenes', exact: true }).click();
  await page.getByLabel('Tint', { exact: true }).fill('#8040ff');
  await page.getByLabel('Tint strength').fill('0.35');
  await page.getByLabel('Darkness', { exact: true }).fill('0.5');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  const overlay = () => Campaign.safeParse(spectator.state).data?.scenes[sceneId]?.overlay;
  await spectator.waitFor('wash sync', () => overlay()?.darkness === 0.5);
  expect(overlay()).toEqual({ tint: '#8040ff', tintOpacity: 0.35, darkness: 0.5 });
  expect(await spectator.intent('scene.setOverlay', { sceneId, overlay: null })).toMatchObject({
    t: 'reject',
  });
  await page.getByRole('button', { name: 'Close Scenes' }).click();
  await expect
    .poll(() => page.evaluate(() => window.__mythicRender?.getObjectCount('scene-overlay')))
    .toBe(1);
  await expect(page.getByText('Clear label', { exact: true })).toBeVisible();
  // The pass must not intercept picking on the token underneath it.
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByText('Clear label', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reset view' })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__mythicRender?.getObjectCount('scene-overlay')))
    .toBe(1);
  await expect(page.getByText('Clear label', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Scenes', exact: true }).click();
  await expect(page.getByLabel('Darkness', { exact: true })).toHaveValue('0.5');
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await spectator.waitFor('wash cleared', () => overlay() === undefined);
  await expect
    .poll(() => page.evaluate(() => window.__mythicRender?.getObjectCount('scene-overlay')))
    .toBe(0);
  expect(errors).toEqual([]);
  await context.close();
  host.close();
  spectator.close();
});
