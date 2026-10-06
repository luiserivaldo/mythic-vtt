import { expect, test } from '@playwright/test';
import { openClient, startTable, type Table } from './harness.js';

// M3-06 (MEAS-02): use the real DM link, place a tall walkable surface, and verify that a
// surface-to-ground ruler exposes horizontal, vertical and total scene-unit distances remotely.
let table: Table | undefined;

test.beforeAll(async () => {
  table = await startTable();
});

test.afterAll(async () => {
  await table?.stop();
});

test('the DM measures a 3D surface and shares the H/V/T readout', async ({ browser }, testInfo) => {
  if (!table) throw new Error('table not started');
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto(`${table.clientUrl.replace(/\/$/, '')}/#host=${table.hostToken}`);
  await expect(page.getByRole('status')).toHaveText('Connected to New campaign');
  await page.getByRole('button', { name: 'Scenes', exact: true }).click();
  await page.getByLabel('New scene name').fill('Vertical test');
  await page.getByRole('button', { name: 'Create scene' }).click();
  await expect(page.getByText('Active', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  const prop = page.getByRole('form', { name: 'Create prop' });
  await prop.getByLabel('Prop name').fill('High platform');
  await prop.getByLabel('Width (cells)').fill('6');
  await prop.getByLabel('Height (cells)').fill('10');
  await prop.getByLabel('Depth (cells)').fill('6');
  await prop.getByLabel('Walkable').check();
  await prop.getByRole('button', { name: 'Create prop' }).click();
  await expect(page.getByRole('button', { name: 'High platform', exact: true })).toBeVisible();

  const viewer = await openClient(browser, table, 'viewer');
  viewer.page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('button', { name: '3D view' }).click();
  await viewer.page.getByRole('button', { name: '3D view' }).click();
  await expect(page.getByRole('button', { name: 'Reset view' })).toBeVisible();
  await expect(viewer.page.getByRole('button', { name: 'Reset view' })).toBeVisible();

  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas box');
  await page.getByRole('button', { name: 'Ruler' }).click();
  // The default 3D camera targets scene centre, where the platform is spawned. The lower-centre
  // point is clear ground; moving to centre ray-hits the platform top.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.82);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });

  const detailed = /^H .+ · V (?!0(?:\.0+)? ft).+ · T .+$/;
  await expect(page.getByTestId('ruler-total')).toHaveText(detailed);
  await expect(viewer.page.getByTestId('remote-ruler-total')).toHaveText(
    /^DM: H .+ · V (?!0(?:\.0+)? ft).+ · T .+$/,
  );
  await page.screenshot({ path: testInfo.outputPath('ruler-3d.png') });
  expect(errors).toEqual([]);

  await viewer.context.close();
  await context.close();
});
