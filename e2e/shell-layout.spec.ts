import { expect, test } from '@playwright/test';
import { startTable, type Table } from './harness.js';

let table: Table | undefined;

test.beforeAll(async () => {
  table = await startTable();
});

test.afterAll(async () => {
  await table?.stop();
});

test('the dock widens the board when collapsed and appearance is per viewer', async ({
  browser,
}) => {
  if (!table) throw new Error('table not started');
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  await page.goto(`${table.clientUrl.replace(/\/$/, '')}/#host=${table.hostToken}`);
  await expect(page.getByRole('status')).toHaveText('Connected to New campaign');

  const board = page.getByLabel('Scene board');
  const dock = page.getByRole('complementary', { name: 'Right dock' });
  const open = await board.boundingBox();
  const dockBox = await dock.boundingBox();
  expect(open).not.toBeNull();
  expect(dockBox).not.toBeNull();
  expect(Math.round((open?.x ?? 0) + (open?.width ?? 0))).toBe(Math.round(dockBox?.x ?? -1));
  expect(Math.round((open?.y ?? 0) + (open?.height ?? 0))).toBe(720);
  await expect(page.locator('main h1')).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveCSS('position', 'absolute');
  await expect(page.locator('main')).toHaveAttribute('data-theme', 'dark');

  await page.getByRole('button', { name: 'Collapse dock' }).click();
  await expect
    .poll(async () => (await board.boundingBox())?.width ?? 0)
    .toBeGreaterThan((open?.width ?? 0) + 200);
  await page.getByRole('button', { name: '3D view' }).click();
  await expect(page.getByRole('button', { name: '3D view' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Expand dock' }).click();

  await page.getByText('Settings', { exact: true }).click();
  await page.getByRole('radio', { name: 'Light' }).check();
  await expect(page.locator('main')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('main')).toHaveCSS('color', 'rgb(23, 43, 69)');
  expect(await page.evaluate(() => localStorage.getItem('mythic.theme'))).toBe('light');
  await page.reload();
  await expect(page.locator('main')).toHaveAttribute('data-theme', 'light');
  await context.close();
});
