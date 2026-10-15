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

// UIUX.md principle 3, UI-TOKEN-02, F01/F02/F03/F18: selecting a token opens its panels beside it
// on the board, and every rail tool's panel opens beside its button or in the left pane, 2D and 3D.
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

  // The new token is selected: its Transform chip shows beside it; the chip opens the panel there.
  const beside = page.getByRole('complementary', { name: 'Selection panels' });
  await beside.getByRole('button', { name: 'Restore Transform panel' }).click();
  await expect(beside.locator('[data-tool-panel="transform"]')).toBeVisible();
  await expect(beside).toHaveAttribute('data-anchored', 'true');
  const board = await page.getByLabel('Scene board').boundingBox();
  const panels = await beside.boundingBox();
  if (!board || !panels) throw new Error('board and selection panels must be visible');
  expect(panels.x).toBeGreaterThanOrEqual(board.x);
  expect(panels.x + panels.width).toBeLessThanOrEqual(board.x + board.width);
  await beside.getByRole('button', { name: 'Restore Token panel' }).click();
  await expect(beside.locator('[data-tool-panel="token"]')).toBeVisible();
  await expectDockHoldsTabsOnly(page);

  // Every rail tool's panel opens beside its button (principle 3) or in the left pane (C17, C20).
  const pane = page.getByRole('complementary', { name: 'Left pane' });
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

  // 3D: the selected token's panels still open beside it, never in the dock.
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByRole('button', { name: '3D view' }).click();
  await page
    .getByRole('list', { name: 'Entities in this scene' })
    .getByRole('button', { name: 'Aria', exact: true })
    .click();
  await expect(beside.locator('[data-tool-panel="transform"]')).toBeVisible();
  await expectDockHoldsTabsOnly(page);
  await context.close();
});
