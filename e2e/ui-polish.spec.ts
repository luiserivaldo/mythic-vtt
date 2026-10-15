import { expect, test } from '@playwright/test';
import { startTable, type Table } from './harness.js';
import { createProp } from './create-prop.js';

// Live-test feedback: entities spawned in the corner, panels pushed the board down, and
// image-less tokens had no colour.
let table: Table | undefined;

test.beforeAll(async () => {
  table = await startTable();
});

test.afterAll(async () => {
  await table?.stop();
});

test('spawns at the scene centre, offsets the next spawn, and keeps panels beside the board', async ({
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

  await page.getByRole('tab', { name: 'Scenes', exact: true }).click();
  await page.getByLabel('New scene name').fill('Cellar');
  await page.getByRole('button', { name: 'Create scene' }).click();
  await expect(page.getByText('Active', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'Entities', exact: true }).click();
  // Opening a dock tab keeps the board width.
  const openBox = await board.boundingBox();
  expect(openBox).toEqual(closedBox);
  const dock = page.getByRole('complementary', { name: 'Selection panels' });

  await page.getByLabel('Token name').fill('Goblin');
  await page.getByLabel('Colour (no image)').fill('#cc3322');
  await page.getByRole('button', { name: 'Create token' }).click();
  const list = page.getByRole('list', { name: 'Entities in this scene' });
  // The form clears its name once the create lands; wait so it cannot wipe the next name.
  await expect(list.getByRole('button', { name: 'Goblin', exact: true })).toBeVisible();
  await page.getByLabel('Token name').fill('Orc');
  await page.getByRole('button', { name: 'Create token' }).click();

  const x = page.getByLabel('X (ft)');
  const z = page.getByLabel('Z (ft)');
  // Default scene: 40 x 30 cells, 5 ft per cell. A medium token snaps to the cell centre at
  // (20.5, 15.5) cells, then the second spawn steps one cell diagonally.
  // MV-239: each selection starts with Transform as its chip; the chip opens it.
  const chip = page.getByRole('button', { name: 'Restore Transform panel' });
  await list.getByRole('button', { name: 'Goblin', exact: true }).click();
  await chip.click();
  await expect(x).toHaveValue('102.5');
  await expect(z).toHaveValue('77.5');
  const selectedBoard = await board.boundingBox();
  const selectedPanels = await dock.boundingBox();
  if (!selectedBoard || !selectedPanels) throw new Error('Selected token panels must be visible');
  // MV-239 / UI-TOKEN-02: the selected token's panels open beside it, on the board, not in the dock.
  expect(selectedPanels.x).toBeGreaterThanOrEqual(selectedBoard.x);
  expect(selectedPanels.x + selectedPanels.width).toBeLessThanOrEqual(
    selectedBoard.x + selectedBoard.width,
  );
  await list.getByRole('button', { name: 'Orc', exact: true }).click();
  await chip.click();
  await expect(x).toHaveValue('107.5');
  await expect(z).toHaveValue('82.5');
  // UX-39 (UI-TOOL-04, MV-266): a new prop lands selected, on a cell centre inside the board.
  await createProp(page, { name: 'Crate' });
  await expect(list.getByRole('button', { name: 'Crate', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await chip.click();
  // 5 ft cells on a 40 x 30 cell board: a cell centre sits 2.5 ft past a multiple of 5.
  for (const [field, extent] of [
    [x, 200],
    [z, 150],
  ] as const) {
    const value = Number(await field.inputValue());
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(extent);
    expect(value % 5).toBe(2.5);
  }

  // The transform panel is readable: light labels (--ui-muted) on the dark panel surface.
  const panel = page.locator('.ui-transform');
  await expect(panel).toHaveCSS('background-color', 'rgb(23, 43, 69)');
  await expect(panel.locator('label').first()).toHaveCSS('color', 'rgb(186, 201, 216)');

  await page.waitForTimeout(500);
  await page.screenshot({ path: testInfo.outputPath('drawer-1280.png') });

  await expect(dock).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
});

test('at phone width the board still fills the window and the dock overlays the board', async ({
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

  await page.getByRole('tab', { name: 'Seats', exact: true }).click();
  const drawer = page.locator('.ui-right-dock');
  await expect(drawer).toBeVisible();
  expect(await board.boundingBox()).toEqual(before);
  const box = await drawer.boundingBox();
  expect(box?.width).toBeLessThanOrEqual(390);
  expect(Math.round((box?.x ?? 0) + (box?.width ?? 0))).toBe(390);
  expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(844);
  // No horizontal page scroll.
  expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
  await context.close();
  await phoneTable.stop();
});
