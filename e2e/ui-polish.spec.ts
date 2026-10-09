import { expect, test } from '@playwright/test';
import { startTable, type Table } from './harness.js';

// Live-test feedback: entities spawned in the corner, panels pushed the board down, and
// image-less tokens had no colour.
let table: Table | undefined;

test.beforeAll(async () => {
  table = await startTable();
});

test.afterAll(async () => {
  await table?.stop();
});

test('spawns at the scene centre, offsets the next spawn, and panels overlay a full-window board', async ({
  browser,
}, testInfo) => {
  if (!table) throw new Error('table not started');
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`${table.clientUrl.replace(/\/$/, '')}/#host=${table.hostToken}`);
  await expect(page.getByRole('status')).toHaveText('Connected to New campaign');

  const board = page.getByLabel('Scene board');
  const closedBox = await board.boundingBox();
  expect(closedBox).not.toBeNull();
  // The board fills the window below the header.
  expect(Math.round((closedBox?.y ?? 0) + (closedBox?.height ?? 0))).toBe(720);

  await page.getByRole('button', { name: 'Scenes', exact: true }).click();
  await page.getByLabel('New scene name').fill('Cellar');
  await page.getByRole('button', { name: 'Create scene' }).click();
  await expect(page.getByText('Active', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  // Opening a tool panel overlays the board: the board keeps its size and the dock sits beside it.
  const openBox = await board.boundingBox();
  expect(openBox).toEqual(closedBox);
  const dock = page.getByRole('complementary', { name: 'Tool panels' });
  const dockBox = await dock.boundingBox();
  expect(dockBox?.x).toBeGreaterThan(600);
  expect((dockBox?.height ?? 0) + (dockBox?.y ?? 0)).toBeLessThanOrEqual(720);

  await page.getByLabel('Token name').fill('Goblin');
  await page.getByLabel('Colour (no image)').fill('#cc3322');
  await page.getByRole('button', { name: 'Create token' }).click();
  await page.getByLabel('Prop name').fill('Crate');
  await page.getByRole('button', { name: 'Create prop' }).click();

  const list = page.getByRole('list', { name: 'Entities in this scene' });
  const x = page.getByLabel('X (ft)');
  const z = page.getByLabel('Z (ft)');
  // Default scene: 40 x 30 cells, 5 ft per cell. A medium token snaps to the cell centre at
  // (20.5, 15.5) cells, then the second spawn steps one cell diagonally.
  await list.getByRole('button', { name: 'Goblin', exact: true }).click();
  await expect(x).toHaveValue('102.5');
  await expect(z).toHaveValue('77.5');
  await list.getByRole('button', { name: 'Crate', exact: true }).click();
  await expect(x).toHaveValue('107.5');
  await expect(z).toHaveValue('82.5');

  // The transform panel is readable: light labels (--ui-muted) on the dark panel surface.
  const panel = page.locator('.ui-transform');
  await expect(panel).toHaveCSS('background-color', 'rgb(23, 33, 43)');
  await expect(panel.locator('label').first()).toHaveCSS('color', 'rgb(169, 182, 195)');

  await page.waitForTimeout(500);
  await page.screenshot({ path: testInfo.outputPath('drawer-1280.png') });

  await dock.getByRole('button', { name: 'Close Entities panel' }).click();
  await expect(dock.getByRole('button', { name: 'Restore Entities panel' })).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
});

test('at phone width the board still fills the window and the drawer is a bottom sheet', async ({
  browser,
}) => {
  // The startup host token is single-use, so this test brings up its own table.
  const phoneTable = await startTable();
  test.setTimeout(60_000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`${phoneTable.clientUrl.replace(/\/$/, '')}/#host=${phoneTable.hostToken}`);
  await expect(page.getByRole('status')).toHaveText('Connected to New campaign');
  const board = page.getByLabel('Scene board');
  const before = await board.boundingBox();
  expect(Math.round((before?.y ?? 0) + (before?.height ?? 0))).toBe(844);

  await page.getByRole('button', { name: 'Seats', exact: true }).click();
  const drawer = page.locator('.ui-drawer');
  await expect(drawer).toBeVisible();
  expect(await board.boundingBox()).toEqual(before);
  const box = await drawer.boundingBox();
  expect(box?.width).toBe(390);
  expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(844);
  // No horizontal page scroll.
  expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
  await context.close();
  await phoneTable.stop();
});
