import { expect, test } from '@playwright/test';
import { startTable, type Table } from './harness.js';

// The DM had no way to create a token or prop, so nothing could be selected or moved.
let table: Table | undefined;

test.beforeAll(async () => {
  table = await startTable();
});

test.afterAll(async () => {
  await table?.stop();
});

test('the host creates a scene, a token and a box from the Entities panel and selects them', async ({
  browser,
}, testInfo) => {
  if (!table) throw new Error('table not started');
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`${table.clientUrl.replace(/\/$/, '')}/#host=${table.hostToken}`);
  await expect(page.getByRole('status')).toHaveText('Connected to New campaign');

  await page.getByRole('button', { name: 'Scenes', exact: true }).click();
  await page.getByLabel('New scene name').fill('Cellar');
  await page.getByRole('button', { name: 'Create scene' }).click();
  // scene.create activates the first scene of a campaign by itself.
  await expect(page.getByText('Active', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page.getByLabel('Token name').fill('Goblin');
  await page.getByRole('button', { name: 'Create token' }).click();
  await page.getByLabel('Prop name').fill('Crate');
  await page.getByRole('button', { name: 'Create prop' }).click();

  const list = page.getByRole('list', { name: 'Entities in this scene' });
  await expect(list.getByRole('button', { name: 'Goblin', exact: true })).toBeVisible();
  await expect(list.getByRole('button', { name: 'Crate', exact: true })).toBeVisible();

  await list.getByRole('button', { name: 'Goblin', exact: true }).click();
  await expect(list.getByRole('button', { name: 'Goblin', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: testInfo.outputPath('board.png') });

  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page.getByRole('button', { name: 'Delete Goblin' }).click();
  await page.getByRole('button', { name: 'Confirm delete Goblin' }).click();
  await expect(list.getByRole('button', { name: 'Goblin', exact: true })).toHaveCount(0);
  await expect(list.getByRole('button', { name: 'Crate', exact: true })).toBeVisible();

  expect(errors).toEqual([]);
  await context.close();
});
