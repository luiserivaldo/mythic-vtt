import { expect, test } from '@playwright/test';
import { startTable, type Table } from './harness.js';

// The DM had no way to create a token or prop, so nothing could be selected or moved.
let table: Table | undefined;

test.beforeAll(async () => {
  table = await startTable();
});

test.afterAll(async () => {
  await table?.stop();
});

test('the host creates a scene, a token and a box from the Entities panel and selects them', async ({
  browser,
}, testInfo) => {
  if (!table) throw new Error('table not started');
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`${table.clientUrl.replace(/\/$/, '')}/#host=${table.hostToken}`);
  await expect(page.getByRole('status')).toHaveText('Connected to New campaign');

  await page.getByRole('button', { name: 'Scenes', exact: true }).click();
  await page.getByLabel('New scene name').fill('Cellar');
  await page.getByRole('button', { name: 'Create scene' }).click();
  // scene.create activates the first scene of a campaign by itself.
  await expect(page.getByText('Active', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  const tokenForm = page.getByRole('form', { name: 'Create token' });
  const tokenFile = tokenForm.locator('input[type="file"]');
  const tokenFileButton = tokenForm.locator('.ui-file-button');
  expect(await tokenFile.boundingBox()).toMatchObject({ width: 1, height: 1 });
  await expect(tokenFileButton).toBeVisible();

  let chooserCount = 0;
  page.on('filechooser', () => {
    chooserCount += 1;
  });
  await tokenForm.getByText('No file chosen').click();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  expect(chooserCount).toBe(0);
  const chooserPromise = page.waitForEvent('filechooser');
  await tokenFileButton.click();
  const chooser = await chooserPromise;
  await chooser.setFiles([]);
  expect(chooserCount).toBe(1);

  await page.getByRole('button', { name: 'Map', exact: true }).click();
  const mapFile = page.getByRole('group', { name: 'Upload image' }).locator('input[type="file"]');
  expect(await mapFile.boundingBox()).toMatchObject({ width: 1, height: 1 });
  await page.getByRole('button', { name: 'Entities', exact: true }).click();

  const primary = page.getByRole('button', { name: 'Create token' });
  await expect(primary).toHaveCSS('background-color', 'rgb(240, 174, 85)');
  await expect(primary).toHaveCSS('color', 'rgb(20, 17, 11)');
  const primaryBox = await primary.boundingBox();
  const formBox = await tokenForm.boundingBox();
  expect(primaryBox?.width).toBeGreaterThan((formBox?.width ?? 0) * 0.9);

  const tokenName = page.getByLabel('Token name');
  await tokenName.fill('Goblin');
  await tokenName.press('Enter');
  await expect(tokenName).toHaveValue('');
  await expect(tokenName).toBeFocused();
  await expect(page.getByTestId('token-label')).toHaveText('Goblin');

  const list = page.getByRole('list', { name: 'Entities in this scene' });
  await expect(list.getByRole('button', { name: 'Goblin', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByLabel('X (ft)')).toBeVisible();

  const propName = page.getByLabel('Prop name');
  await propName.fill('Crate');
  await page.getByRole('button', { name: 'Create prop' }).click();
  await expect(propName).toHaveValue('');
  await expect(propName).toBeFocused();

  await expect(list.getByRole('button', { name: 'Goblin', exact: true })).toBeVisible();
  await expect(list.getByRole('button', { name: 'Crate', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await list.getByRole('button', { name: 'Goblin', exact: true }).click();
  await expect(list.getByRole('button', { name: 'Goblin', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: testInfo.outputPath('board.png') });

  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page.getByRole('button', { name: 'Delete Goblin' }).click();
  await page.getByRole('button', { name: 'Confirm delete Goblin' }).click();
  await expect(list.getByRole('button', { name: 'Goblin', exact: true })).toHaveCount(0);
  await expect(list.getByRole('button', { name: 'Crate', exact: true })).toBeVisible();

  expect(errors).toEqual([]);
  await context.close();
});
