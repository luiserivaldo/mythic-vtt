import { expect, test, type Browser, type Page } from '@playwright/test';
import { settledCellToPixel } from './board-map.js';
import { startTable, type Table } from './harness.js';

// UI-TOKEN-07 (MV-266) with UI-INPUT: the left pane sits in flow, so opening it moves the board.
// It may only open once the pointer is up and the double-click window has passed, so a
// double-click or a press-and-drag on a token lands on that token.

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

test('a double-click on a token with the pane collapsed focuses that token', async ({
  browser,
}) => {
  const page = await dmWithTokens(browser, ['Goblin', 'Orc']);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const pane = page.getByRole('complementary', { name: 'Left pane' });
  const list = page.getByRole('list', { name: 'Entities in this scene' });

  // Goblin is selected with its panels in the pane; the user collapses the pane.
  await list.getByRole('button', { name: 'Goblin', exact: true }).click();
  await expect(pane.getByRole('region', { name: 'Transform: Goblin' })).toBeVisible();
  await pane.getByRole('button', { name: 'Collapse left pane' }).click();
  await expect(pane.getByRole('button', { name: 'Expand left pane' })).toBeVisible();

  // Orc spawned one cell diagonally from the centre cell (20.5, 15.5): (21.5, 16.5).
  const at = await settledCellToPixel(page);
  const orc = at(21.5, 16.5);
  const board = await page.locator('canvas').boundingBox();
  // Two separate clicks inside the double-click window, frames apart: the first selects Orc, and
  // a pane that widened in between would move Orc out from under the second.
  await page.mouse.click(orc.x, orc.y);
  await page.waitForTimeout(200);
  await page.mouse.click(orc.x, orc.y, { clickCount: 2 });

  // The pane waited, so the second click landed on Orc too and focused it (CAM-06).
  await page.waitForFunction(() => {
    const view = (globalThis as unknown as Diagnostics).__mythicFocus?.getView2d();
    return (
      view !== undefined &&
      !view.animating &&
      Math.abs(view.centerX - 21.5) < 1e-6 &&
      Math.abs(view.centerZ - 16.5) < 1e-6
    );
  });
  // Then, the pointer up and the window passed, the new selection re-expands the pane.
  await expect(pane.getByRole('region', { name: 'Transform: Orc' })).toBeVisible();
  await expect(pane.getByRole('button', { name: 'Collapse left pane' })).toBeVisible();
  // The board narrowed only after the double-click; the focused view survives it.
  await expect
    .poll(async () => (await page.locator('canvas').boundingBox())?.width)
    .toBeLessThan(board?.width ?? 0);
  const view = await page.evaluate(() =>
    (globalThis as unknown as Diagnostics).__mythicFocus?.getView2d(),
  );
  expect(view?.centerX).toBeCloseTo(21.5, 6);
  expect(view?.centerZ).toBeCloseTo(16.5, 6);
  expect(errors).toEqual([]);
  await page.context().close();
});

test('a token pressed right after its selecting click drags, and the pane waits for the release', async ({
  browser,
}) => {
  const page = await dmWithTokens(browser, ['Goblin']);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const pane = page.getByRole('complementary', { name: 'Left pane' });
  const list = page.getByRole('list', { name: 'Entities in this scene' });

  // Nothing selected, so no pane and the board at full width.
  await page.getByLabel('Scene board').focus();
  await page.keyboard.press('Escape');
  await expect(pane).toHaveCount(0);
  const at = await settledCellToPixel(page);
  const board = await page.locator('canvas').boundingBox();
  const start = at(20.5, 15.5);

  // Selection happens on click, so select first: the press that follows is a drag of the
  // selected token, and its panels are still waiting out the double-click window.
  await page.mouse.click(start.x, start.y);
  await page.waitForTimeout(100);
  await page.mouse.down();
  await page.mouse.move(start.x - at.zoom, start.y, { steps: 5 });
  await page.mouse.move(start.x - 2 * at.zoom, start.y, { steps: 5 });
  // Held well past the double-click window: the pane must still wait, or the board would move
  // under the drag.
  await page.waitForTimeout(800);
  expect(await page.locator('canvas').boundingBox()).toEqual(board);
  await expect(pane).toHaveCount(0);
  await page.mouse.up();

  // Dropped two cells left: 18.5 cells is 92.5 ft at 5 ft per cell.
  await list.getByRole('button', { name: 'Goblin', exact: true }).click();
  await expect(pane.getByLabel('X (ft)')).toHaveValue('92.5');
  await expect(pane.getByLabel('Z (ft)')).toHaveValue('77.5');
  expect(errors).toEqual([]);
  await page.context().close();
});
