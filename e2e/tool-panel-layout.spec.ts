import { expect, test } from '@playwright/test';
import { startTable, type Table } from './harness.js';

let table: Table;

test.beforeAll(async () => {
  table = await startTable();
});

test.afterAll(async () => {
  await table.stop();
});

test('selection panels stack beside the token and tool panels collapse to restore buttons', async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(`${table.clientUrl}/#host=${table.hostToken}`);
  await expect(page.getByRole('status')).toHaveText('Connected to New campaign');

  await page.getByRole('tab', { name: 'Scenes', exact: true }).click();
  await page.getByLabel('New scene name').fill('Panel test');
  await page.getByRole('button', { name: 'Create scene' }).click();
  await page.getByRole('tab', { name: 'Entities', exact: true }).click();
  await page.getByLabel('Token name').fill('Dock token');
  await page.getByRole('button', { name: 'Create token' }).click();

  // MV-239 / UI-TOKEN-02: the selected token's panels open beside it, over the board. Transform
  // and Token both start as chips (owner ruling): selecting covers nothing.
  const dock = page.getByRole('complementary', { name: 'Selection panels' });
  const panels = dock.locator('[data-tool-panel]');
  await expect(dock.getByRole('button', { name: 'Restore Transform panel' })).toBeVisible();
  await expect(dock.getByRole('button', { name: 'Restore Token panel' })).toBeVisible();
  await expect(panels).toHaveCount(0);
  // The chip is how the user calls up the Transform tool.
  await dock.getByRole('button', { name: 'Restore Transform panel' }).click();
  await expect(panels).toHaveCount(1);
  await expect(panels.nth(0)).toHaveAttribute('data-tool-panel', 'transform');
  await dock.getByRole('button', { name: 'Restore Token panel' }).click();
  await expect(panels).toHaveCount(2);
  await expect(panels.nth(1)).toHaveAttribute('data-tool-panel', 'token');
  const boxes = await Promise.all([0, 1].map((index) => panels.nth(index).boundingBox()));
  expect((boxes[0]?.y ?? 0) + (boxes[0]?.height ?? 0)).toBeLessThanOrEqual(boxes[1]?.y ?? 0);

  await dock.getByRole('button', { name: 'Close Token panel' }).click();
  await expect(dock.getByRole('button', { name: 'Restore Token panel' })).toBeVisible();

  await dock.getByRole('button', { name: 'Close Transform panel' }).click();
  await expect(page.getByRole('button', { name: 'Restore Transform panel' })).toBeVisible();
  await page.getByRole('button', { name: 'Restore Transform panel' }).click();

  // UI-MEAS-01: the Measure panel opens beside its rail button, never in the dock.
  await page.getByRole('button', { name: 'Measure', exact: true }).click();
  const pane = page.getByRole('complementary', { name: 'Measure', exact: true });
  await expect(dock.locator('[data-tool-panel="ruler"]')).toHaveCount(0);
  await page.getByRole('radio', { name: 'Cone', exact: true }).check();
  await pane.getByRole('button', { name: 'Close Measure panel' }).click();
  await expect(page.getByRole('button', { name: 'Restore Measure panel' })).toBeVisible();
  await page.getByRole('button', { name: 'Restore Measure panel' }).click();
  await expect(page.getByRole('radio', { name: 'Cone', exact: true })).toBeChecked();

  await context.close();
});
