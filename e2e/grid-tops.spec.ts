import { expect, test } from '@playwright/test';
import { startTable, type Table } from './harness.js';

// M3-07 (GRID-05): a walkable box with "show grid on top" renders in 3D without page errors.
let table: Table | undefined;

test.beforeAll(async () => {
  table = await startTable();
});
test.afterAll(async () => {
  await table?.stop();
});

test('the host toggles the grid on a walkable box and views it in 3D', async ({ browser }) => {
  if (!table) throw new Error('table not started');
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`${table.clientUrl.replace(/\/$/, '')}/#host=${table.hostToken}`);
  await expect(page.getByRole('status')).toHaveText('Connected to New campaign');
  await page.getByRole('button', { name: 'Scenes', exact: true }).click();
  await page.getByLabel('New scene name').fill('Tower');
  await page.getByRole('button', { name: 'Create scene' }).click();
  await expect(page.getByText('Active', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page.getByLabel('Prop name').fill('Dais');
  await page.getByLabel('Walkable').check();
  await page.getByRole('button', { name: 'Create prop' }).click();
  const list = page.getByRole('list', { name: 'Entities in this scene' });
  await list.getByRole('button', { name: 'Dais', exact: true }).click();
  const toggle = page.getByLabel('Show grid on top of Dais');
  await toggle.check();
  await expect(toggle).toBeChecked();

  await page.getByRole('button', { name: '3D view' }).click();
  await expect(page.getByRole('button', { name: 'Reset view' })).toBeVisible();
  await page.waitForTimeout(1000);
  expect(errors).toEqual([]);
  await context.close();
});
