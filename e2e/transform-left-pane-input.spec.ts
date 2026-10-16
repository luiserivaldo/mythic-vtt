import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { settledCellToPixel } from './board-map.js';
import { startTable, type Table } from './harness.js';

// UI-TOKEN-07 (MV-266) with UI-INPUT, MV-279: the left pane floats over the board's left edge, so
// opening it on a selection never moves the board. A double-click or a press-and-drag on a token
// lands on that token however soon after the selecting click it comes.

let table: Table;

test.beforeEach(async () => {
  table = await startTable();
});

test.afterEach(async () => {
  await table.stop();
});

interface Diagnostics {
  __mythicFocus?: { getView2d(): { centerX: number; centerZ: number; animating: boolean } };
}

/** A DM page on a new scene with the given tokens (spawned at the centre, stepping diagonally). */
async function dmWithTokens(browser: Browser, names: string[]): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1600, height: 800 } });
  const page = await context.newPage();
  await page.goto(`${table.clientUrl}/#host=${table.hostToken}`);
  await expect(page.getByRole('status')).toHaveText('Connected to New campaign');
  await page.getByRole('tab', { name: 'Scenes', exact: true }).click();
  await page.getByLabel('New scene name').fill('Pane input');
  await page.getByRole('button', { name: 'Create scene' }).click();
  await expect(page.getByText('Active', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Entities', exact: true }).click();
  const list = page.getByRole('list', { name: 'Entities in this scene' });
  for (const name of names) {
    await page.getByLabel('Token name').fill(name);
    await page.getByRole('button', { name: 'Create token' }).click();
    await expect(list.getByRole('button', { name, exact: true })).toBeVisible();
  }
  return page;
}

/** The pane floats right of the rail and over the board, which starts at the window's edge. */
async function expectPaneOverBoard(page: Page, pane: Locator) {
  const board = await page.getByLabel('Scene board').boundingBox();
  const rail = await page.getByRole('toolbar', { name: 'Board controls' }).boundingBox();
  const box = await pane.boundingBox();
  if (!board || !rail || !box) throw new Error('board, rail and pane must be visible');
  expect(Math.round(board.x)).toBe(0);
  expect(box.x).toBeGreaterThanOrEqual(rail.x + rail.width);
  expect(box.x + box.width).toBeLessThan(board.x + board.width);
}

test('a double-click on a token with the pane collapsed focuses it and never moves the board', async ({
  browser,
}) => {
  const page = await dmWithTokens(browser, ['Goblin', 'Orc']);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const pane = page.getByRole('complementary', { name: 'Left pane' });
  const list = page.getByRole('list', { name: 'Entities in this scene' });
  const canvas = page.locator('canvas');

  // Goblin is selected with its panels in the pane; the user collapses the pane.
  await list.getByRole('button', { name: 'Goblin', exact: true }).click();
  await expect(pane.getByRole('region', { name: 'Transform: Goblin' })).toBeVisible();
  await pane.getByRole('button', { name: 'Collapse left pane' }).click();
  await expect(pane.getByRole('button', { name: 'Expand left pane' })).toBeVisible();

  // Orc spawned one cell diagonally from the centre cell (20.5, 15.5): (21.5, 16.5).
  const at = await settledCellToPixel(page);
  const orc = at(21.5, 16.5);
  const board = await canvas.boundingBox();
  // The first click selects Orc, which re-expands the pane over the board's edge...
  await page.mouse.click(orc.x, orc.y);
  await expect(pane.getByRole('region', { name: 'Transform: Orc' })).toBeVisible();
  await expect(pane.getByRole('button', { name: 'Collapse left pane' })).toBeVisible();
  await expectPaneOverBoard(page, pane);
  // ...and the board has not moved, so the second click of the pair lands on Orc as well.
  expect(await canvas.boundingBox()).toEqual(board);
  await page.mouse.click(orc.x, orc.y, { clickCount: 2 });

  // The double-click focused Orc (CAM-06).
  await expect
    .poll(() =>
      page.evaluate(() => {
        const view = (globalThis as unknown as Diagnostics).__mythicFocus?.getView2d();
        if (!view || view.animating) return null;
        return [view.centerX, view.centerZ].map((v) => Math.round(v * 1000) / 1000);
      }),
    )
    .toEqual([21.5, 16.5]);
  expect(await canvas.boundingBox()).toEqual(board);
  expect(errors).toEqual([]);
  await page.context().close();
});

test('a token pressed right after its selecting click drags, and the board stays put', async ({
  browser,
}) => {
  const page = await dmWithTokens(browser, ['Goblin']);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const pane = page.getByRole('complementary', { name: 'Left pane' });
  const list = page.getByRole('list', { name: 'Entities in this scene' });
  const canvas = page.locator('canvas');

  // Nothing selected, so no pane.
  await page.getByLabel('Scene board').focus();
  await page.keyboard.press('Escape');
  await expect(pane).toHaveCount(0);
  const at = await settledCellToPixel(page);
  const board = await canvas.boundingBox();
  const start = at(20.5, 15.5);

  // Selection happens on click, so select first: the press that follows at once is a drag of the
  // selected token. The pane opens on the selection without moving the board under the press.
  await page.mouse.click(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x - at.zoom, start.y, { steps: 5 });
  await page.mouse.move(start.x - 2 * at.zoom, start.y, { steps: 5 });
  await expect(pane.getByRole('region', { name: 'Transform: Goblin' })).toBeVisible();
  expect(await canvas.boundingBox()).toEqual(board);
  await page.mouse.up();

  // Dropped two cells left: 18.5 cells is 92.5 ft at 5 ft per cell.
  await expect(list.getByRole('button', { name: 'Goblin', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(pane.getByLabel('X (ft)')).toHaveValue('92.5');
  await expect(pane.getByLabel('Z (ft)')).toHaveValue('77.5');
  expect(await canvas.boundingBox()).toEqual(board);
  expect(errors).toEqual([]);
  await page.context().close();
});
