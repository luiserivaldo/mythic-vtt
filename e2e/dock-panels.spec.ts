import { expect, test, type Page } from '@playwright/test';
import { startTable, type Table } from './harness.js';

let table: Table | undefined;

test.beforeAll(async () => {
  table = await startTable();
});

test.afterAll(async () => {
  await table?.stop();
});

/** MV-239: the right dock holds tabs only. No tool or token panel may render inside it. */
async function expectDockHoldsTabsOnly(page: Page) {
  const dock = page.getByRole('complementary', { name: 'Right dock' });
  await expect(dock.locator('[data-tool-panel]')).toHaveCount(0);
  await expect(dock.locator('.ui-tool-peek')).toHaveCount(0);
  await expect(dock.locator('.ui-context-panel-slot')).toHaveCount(0);
  await expect(dock.getByRole('complementary', { name: 'Selection panels' })).toHaveCount(0);
}

// UIUX.md principle 3, UI-TOKEN-07 (MV-266), F01/F02/F03/F18: selecting a token opens its panels in
// the left pane, and every rail tool's panel opens beside its button or in the left pane, 2D and 3D.
test('no tool or token panel renders inside the right dock', async ({ browser }) => {
  if (!table) throw new Error('table not started');
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(`${table.clientUrl}/#host=${table.hostToken}`);
  await expect(page.getByRole('status')).toHaveText('Connected to New campaign');

  await page.getByRole('tab', { name: 'Scenes', exact: true }).click();
  await page.getByLabel('New scene name').fill('Dock panels');
  await page.getByRole('button', { name: 'Create scene' }).click();
  await page.getByRole('tab', { name: 'Entities', exact: true }).click();
  await page.getByLabel('Token name').fill('Aria');
  await page.getByRole('button', { name: 'Create token' }).click();

  // The new token is selected: its Transform panel is open in the left pane, which floats over
  // the board's left edge, right of the rail (MV-279).
  const pane = page.getByRole('complementary', { name: 'Left pane' });
  await expect(pane.locator('[data-tool-panel="transform"]')).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Selection panels' })).toHaveCount(0);
  const board = await page.getByLabel('Scene board').boundingBox();
  const rail = await page.getByRole('toolbar', { name: 'Board controls' }).boundingBox();
  const panes = await pane.boundingBox();
  if (!board || !rail || !panes) throw new Error('board, rail and left pane must be visible');
  expect(panes.x).toBeGreaterThanOrEqual(rail.x + rail.width);
  expect(panes.x + panes.width).toBeLessThan(board.x + board.width);
  await pane.getByRole('button', { name: 'Restore Token panel' }).click();
  await expect(pane.locator('[data-tool-panel="token"]')).toBeVisible();
  await expectDockHoldsTabsOnly(page);

  // Every rail tool's panel opens beside its button (principle 3) or in the left pane (C17, C20).
  for (const [tool, panel, popover] of [
    ['Draw', 'draw', null],
    ['Create Prop', 'create-prop', null],
    ['Initiative', 'initiative', null],
    ['Measure', 'ruler', 'Measure'],
  ] as const) {
    await page.getByRole('button', { name: tool, exact: true }).click();
    const region = popover ? page.getByRole('complementary', { name: popover, exact: true }) : pane;
    await expect(region.locator(`[data-tool-panel="${panel}"]`)).toBeVisible();
    await expectDockHoldsTabsOnly(page);
    if (popover) {
      const button = await page.getByRole('button', { name: tool, exact: true }).boundingBox();
      const box = await region.boundingBox();
      if (!button || !box) throw new Error('rail button and its panel must be visible');
      expect(box.x).toBeGreaterThan(button.x + button.width);
    }
  }
  await page.getByRole('button', { name: 'Measure', exact: true }).click();

  // 3D: the selected token's panels still open in the left pane, never in the dock.
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByRole('button', { name: '3D view' }).click();
  await page
    .getByRole('list', { name: 'Entities in this scene' })
    .getByRole('button', { name: 'Aria', exact: true })
    .click();
  await expect(pane.locator('[data-tool-panel="transform"]')).toBeVisible();
  await expectDockHoldsTabsOnly(page);
  await context.close();
});
