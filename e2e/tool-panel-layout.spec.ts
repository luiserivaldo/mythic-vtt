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
  await expect(panels).toHaveCount(3);
  await expect(panels.nth(0)).toHaveAttribute('data-tool-panel', 'entities');
  await expect(panels.nth(1)).toHaveAttribute('data-tool-panel', 'transform');
  await expect(panels.nth(2)).toHaveAttribute('data-tool-panel', 'aoe');
  const boxes = await Promise.all([0, 1, 2].map((index) => panels.nth(index).boundingBox()));
  expect((boxes[0]?.y ?? 0) + (boxes[0]?.height ?? 0)).toBeLessThanOrEqual(boxes[1]?.y ?? 0);
  expect((boxes[1]?.y ?? 0) + (boxes[1]?.height ?? 0)).toBeLessThanOrEqual(boxes[2]?.y ?? 0);

  await dock.getByRole('button', { name: 'Close Transform panel' }).click();
  await expect(page.getByRole('button', { name: 'Restore Transform panel' })).toBeVisible();
  await page.getByRole('button', { name: 'Restore Transform panel' }).click();

  const aoe = page.getByRole('region', { name: 'AoE tool' });
  const placement = aoe.getByRole('button', { name: 'AoE placement' });
  await placement.click();
  await expect(placement).toHaveAttribute('aria-pressed', 'true');
  await dock.getByRole('button', { name: 'Close AoE panel' }).click();
  await expect(page.getByRole('button', { name: 'Restore AoE panel' })).toBeVisible();
  await page.getByRole('button', { name: 'Restore AoE panel' }).click();
  await expect(placement).toHaveAttribute('aria-pressed', 'true');

  await dock.getByRole('button', { name: 'Close Entities panel' }).click();
  await expect(page.getByRole('button', { name: 'Restore Entities panel' })).toBeVisible();

  await context.close();
});
