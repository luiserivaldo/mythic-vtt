import { expect, test } from '@playwright/test';
import { startTable, type Table } from './harness.js';

interface PanelRegions {
  __mythicPanelRegions?: {
    set(id: string, region: 'left-pane' | 'beside-rail' | 'beside-token'): void;
  };
}

let table: Table | undefined;

test.beforeAll(async () => {
  table = await startTable();
});

test.afterAll(async () => {
  await table?.stop();
});

// UX-37 / UI-SHELL-05: a panel registered to the left pane opens there, beside the rail, and not
// in the right dock. Initiative is registered there since UX-38 (MV-254); the development build's
// routing hook call below is then a no-op, kept so the check survives future panel moves.
test('a panel registered to the left pane renders there over the board, and collapses', async ({
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
  const closed = await board.boundingBox();
  expect(Math.round(closed?.x ?? -1)).toBe(0);

  await page.evaluate(() => {
    (globalThis as unknown as PanelRegions).__mythicPanelRegions?.set('initiative', 'left-pane');
  });
  await page.getByRole('button', { name: 'Initiative', exact: true }).click();

  await expect(pane.locator('[data-tool-panel="initiative"]')).toBeVisible();
  await expect(pane.getByRole('region', { name: 'Rounds and initiative' })).toBeVisible();
  await expect(dock.locator('[data-tool-panel]')).toHaveCount(0);
  await expect(dock.getByRole('region', { name: 'Rounds and initiative' })).toHaveCount(0);

  // MV-279: the pane floats over the board's left edge, right of the rail; the board keeps its
  // size and place.
  const paneBox = await pane.boundingBox();
  const rail = await page.getByRole('toolbar', { name: 'Board controls' }).boundingBox();
  expect(await board.boundingBox()).toEqual(closed);
  expect(paneBox?.x ?? 0).toBeGreaterThanOrEqual((rail?.x ?? Infinity) + (rail?.width ?? 0));

  // Collapsed, it shrinks to a strip at the same place; the board still does not move.
  await pane.getByRole('button', { name: 'Collapse left pane' }).click();
  await expect(pane.locator('[data-tool-panel="initiative"]')).toBeHidden();
  await expect
    .poll(async () => (await pane.boundingBox())?.width ?? Infinity)
    .toBeLessThan((paneBox?.width ?? 0) - 150);
  expect((await pane.boundingBox())?.x).toBe(paneBox?.x);
  expect(await board.boundingBox()).toEqual(closed);

  // 2D and 3D share the pane; picking the tool again reveals it.
  await page.getByRole('button', { name: '3D view' }).click();
  await page.getByRole('button', { name: 'Initiative', exact: true }).click();
  await expect(pane.getByRole('button', { name: 'Collapse left pane' })).toBeVisible();
  await expect(pane.locator('[data-tool-panel="initiative"]')).toBeVisible();
  await expect(dock.locator('[data-tool-panel]')).toHaveCount(0);

  // Leaving the tool closes its panel and the empty pane.
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await expect(pane).toHaveCount(0);
  expect(await board.boundingBox()).toEqual(closed);
  await context.close();
});
