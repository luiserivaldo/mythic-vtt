import { expect, test } from '@playwright/test';
import { startTable, type Table } from './harness.js';

interface PanelRegions {
  __mythicPanelRegions?: { set(id: string, region: 'left-pane' | 'right-dock'): void };
}

let table: Table | undefined;

test.beforeAll(async () => {
  table = await startTable();
});

test.afterAll(async () => {
  await table?.stop();
});

// UX-37 / UI-SHELL-05: a panel registered to the left pane opens there, beside the rail, and not
// in the right dock. No shipped panel is registered to the pane yet (MV-254, MV-255 move them), so
// the development build's routing hook sends the Initiative panel there for this check.
test('a panel registered to the left pane renders there, collapses, and widens the board', async ({
  browser,
}) => {
  if (!table) throw new Error('table not started');
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  await page.goto(`${table.clientUrl}/#host=${table.hostToken}`);
  await expect(page.getByRole('status')).toHaveText('Connected to New campaign');

  const pane = page.getByRole('complementary', { name: 'Left pane' });
  const dock = page.getByRole('complementary', { name: 'Right dock' });
  const board = page.getByLabel('Scene board');
  // With nothing registered to it the pane is absent and the board starts at the window edge.
  await expect(pane).toHaveCount(0);
  expect(Math.round((await board.boundingBox())?.x ?? -1)).toBe(0);

  await page.evaluate(() => {
    (globalThis as unknown as PanelRegions).__mythicPanelRegions?.set('initiative', 'left-pane');
  });
  await page.getByRole('button', { name: 'Initiative', exact: true }).click();

  await expect(pane.locator('[data-tool-panel="initiative"]')).toBeVisible();
  await expect(pane.getByRole('region', { name: 'Rounds and initiative' })).toBeVisible();
  await expect(dock.locator('[data-tool-panel]')).toHaveCount(0);
  await expect(dock.getByRole('region', { name: 'Rounds and initiative' })).toHaveCount(0);

  // The pane is in normal flow: the board starts at its right edge, and the rail floats beside it.
  const paneBox = await pane.boundingBox();
  const open = await board.boundingBox();
  const rail = await page.getByRole('toolbar', { name: 'Board controls' }).boundingBox();
  expect(Math.round(open?.x ?? -1)).toBe(Math.round((paneBox?.x ?? 0) + (paneBox?.width ?? 0)));
  expect(rail?.x ?? 0).toBeGreaterThanOrEqual(open?.x ?? Infinity);

  await pane.getByRole('button', { name: 'Collapse left pane' }).click();
  await expect(pane.locator('[data-tool-panel="initiative"]')).toBeHidden();
  await expect
    .poll(async () => (await board.boundingBox())?.width ?? 0)
    .toBeGreaterThan((open?.width ?? 0) + 150);

  // 2D and 3D share the pane; picking the tool again reveals it.
  await page.getByRole('button', { name: '3D view' }).click();
  await page.getByRole('button', { name: 'Initiative', exact: true }).click();
  await expect(pane.getByRole('button', { name: 'Collapse left pane' })).toBeVisible();
  await expect(pane.locator('[data-tool-panel="initiative"]')).toBeVisible();
  await expect(dock.locator('[data-tool-panel]')).toHaveCount(0);

  // Leaving the tool closes its panel, and the empty pane gives the width back to the board.
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await expect(pane).toHaveCount(0);
  await context.close();
});
