import { expect, test } from '@playwright/test';
import { startTable, type Table } from './harness.js';

let table: Table;

test.beforeAll(async () => {
  table = await startTable();
});

test.afterAll(async () => {
  await table.stop();
});

test('tool panels share an ordered dock and active tools collapse to restore buttons', async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(`${table.clientUrl}/#host=${table.hostToken}`);
  await expect(page.getByRole('status')).toHaveText('Connected to New campaign');

  await page.getByRole('button', { name: 'Scenes', exact: true }).click();
  await page.getByLabel('New scene name').fill('Panel test');
  await page.getByRole('button', { name: 'Create scene' }).click();
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page.getByLabel('Token name').fill('Dock token');
  await page.getByRole('button', { name: 'Create token' }).click();

  const dock = page.getByRole('complementary', { name: 'Tool panels' });
  const panels = dock.locator('[data-tool-panel]');
  await expect(panels).toHaveCount(2);
  await expect(panels.nth(0)).toHaveAttribute('data-tool-panel', 'entities');
  await expect(panels.nth(1)).toHaveAttribute('data-tool-panel', 'transform');
  const boxes = await Promise.all([0, 1].map((index) => panels.nth(index).boundingBox()));
  expect((boxes[0]?.y ?? 0) + (boxes[0]?.height ?? 0)).toBeLessThanOrEqual(boxes[1]?.y ?? 0);

  await dock.getByRole('button', { name: 'Close Transform panel' }).click();
  await expect(page.getByRole('button', { name: 'Restore Transform panel' })).toBeVisible();
  await page.getByRole('button', { name: 'Restore Transform panel' }).click();

  await page.getByRole('button', { name: 'Ruler', exact: true }).click();
  await page.getByText('Measurement shapes', { exact: true }).click();
  await page.getByLabel('Measurement shape').selectOption('cone');
  await dock.getByRole('button', { name: 'Close Ruler panel' }).click();
  await expect(page.getByRole('button', { name: 'Restore Ruler panel' })).toBeVisible();
  await page.getByRole('button', { name: 'Restore Ruler panel' }).click();
  await expect(page.getByLabel('Measurement shape')).toHaveValue('cone');

  await dock.getByRole('button', { name: 'Close Entities panel' }).click();
  await expect(page.getByRole('button', { name: 'Restore Entities panel' })).toBeVisible();

  await context.close();
});
