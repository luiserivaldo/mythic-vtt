import { expect, test, type Page } from '@playwright/test';
import { startTable, type Table } from './harness.js';

// UI-TOKEN-07 / C23 (MV-266, UX-49): selecting an object expands its Transform panel in the left
// pane, in 2D and 3D. Deselecting hides it, and selecting another object swaps in its values.
// There is no chip and no Close in the normal flow.

let table: Table;

test.beforeAll(async () => {
  table = await startTable();
});

test.afterAll(async () => {
  await table.stop();
});

async function expectNoChipOrClose(page: Page) {
  await expect(page.getByRole('button', { name: 'Restore Transform panel' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Close Transform panel' })).toHaveCount(0);
  // Nothing opens beside the token any more.
  await expect(page.getByRole('complementary', { name: 'Selection panels' })).toHaveCount(0);
}

test('selection opens Transform in the left pane, 2D and 3D; deselect hides it', async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${table.clientUrl}/#host=${table.hostToken}`);
  await expect(page.getByRole('status')).toHaveText('Connected to New campaign');

  await page.getByRole('tab', { name: 'Scenes', exact: true }).click();
  await page.getByLabel('New scene name').fill('Left pane transform');
  await page.getByRole('button', { name: 'Create scene' }).click();
  await expect(page.getByText('Active', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Entities', exact: true }).click();
  const list = page.getByRole('list', { name: 'Entities in this scene' });
  await page.getByLabel('Token name').fill('Goblin');
  await page.getByRole('button', { name: 'Create token' }).click();
  await expect(list.getByRole('button', { name: 'Goblin', exact: true })).toBeVisible();
  await page.getByLabel('Token name').fill('Orc');
  await page.getByRole('button', { name: 'Create token' }).click();
  await expect(list.getByRole('button', { name: 'Orc', exact: true })).toBeVisible();

  const pane = page.getByRole('complementary', { name: 'Left pane' });
  const transform = pane.locator('[data-tool-panel="transform"]');
  const dock = page.getByRole('complementary', { name: 'Right dock' });

  // 2D: selecting Goblin opens its Transform, expanded, in the left pane.
  await list.getByRole('button', { name: 'Goblin', exact: true }).click();
  await expect(transform).toBeVisible();
  await expect(transform).toHaveCount(1);
  await expect(transform.getByRole('region', { name: 'Transform: Goblin' })).toBeVisible();
  // Default scene: 40 x 30 cells, 5 ft per cell; the second spawn steps one cell diagonally.
  await expect(transform.getByLabel('X (ft)')).toHaveValue('102.5');
  await expect(transform.getByLabel('Z (ft)')).toHaveValue('77.5');
  await expectNoChipOrClose(page);
  await expect(dock.locator('[data-tool-panel]')).toHaveCount(0);

  // Selecting Orc replaces the panel with Orc's values.
  await list.getByRole('button', { name: 'Orc', exact: true }).click();
  await expect(transform).toHaveCount(1);
  await expect(transform.getByRole('region', { name: 'Transform: Orc' })).toBeVisible();
  await expect(transform.getByLabel('X (ft)')).toHaveValue('107.5');
  await expect(transform.getByLabel('Z (ft)')).toHaveValue('82.5');
  await expectNoChipOrClose(page);
  // Give Orc a distinct size so its 3D panel (Y and Size only, for a token) shows its own values.
  await transform.getByLabel('Size (cells)').fill('2');
  await transform.getByLabel('Size (cells)').press('Enter');
  await expect(transform.getByLabel('Size (cells)')).toHaveValue('2');

  // A collapsed pane expands again on the next selection.
  await pane.getByRole('button', { name: 'Collapse left pane' }).click();
  await expect(transform).toBeHidden();
  await list.getByRole('button', { name: 'Goblin', exact: true }).click();
  await expect(transform.getByRole('region', { name: 'Transform: Goblin' })).toBeVisible();

  // Deselect (Escape on the board) hides the panel, and the empty pane goes with it.
  await page.getByLabel('Scene board').focus();
  await page.keyboard.press('Escape');
  await expect(list.getByRole('button', { name: 'Goblin', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(transform).toHaveCount(0);
  await expect(pane).toHaveCount(0);

  // Choosing Select with something selected shows that selection's Transform.
  await list.getByRole('button', { name: 'Goblin', exact: true }).click();
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  await pane.getByRole('button', { name: 'Collapse left pane' }).click();
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await expect(pane.locator('[data-tool-panel="draw"]')).toHaveCount(0);
  await expect(transform.getByRole('region', { name: 'Transform: Goblin' })).toBeVisible();

  // 3D: the same left pane, the same swap and the same hide.
  await page.getByRole('button', { name: '3D view' }).click();
  await expect(transform.getByRole('region', { name: 'Transform: Goblin' })).toBeVisible();
  await expect(transform.getByLabel('Size (cells)')).toHaveValue('1');
  await list.getByRole('button', { name: 'Orc', exact: true }).click();
  await expect(transform).toHaveCount(1);
  await expect(transform.getByRole('region', { name: 'Transform: Orc' })).toBeVisible();
  await expect(transform.getByLabel('Size (cells)')).toHaveValue('2');
  await expectNoChipOrClose(page);
  await expect(dock.locator('[data-tool-panel]')).toHaveCount(0);
  await page.getByLabel('Scene board').focus();
  await page.keyboard.press('Escape');
  await expect(transform).toHaveCount(0);
  await list.getByRole('button', { name: 'Goblin', exact: true }).click();
  await expect(transform.getByRole('region', { name: 'Transform: Goblin' })).toBeVisible();

  expect(errors).toEqual([]);
  await context.close();
});
