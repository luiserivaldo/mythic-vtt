import { expect, test } from '@playwright/test';
import { startTable, type Table } from './harness.js';

// D37: scenes have a fixed canvas. The DM creates a scene with a size through the panel and
// resizes it; nothing may throw while the board frames, clips the grid and clamps the camera.
let table: Table | undefined;

test.beforeAll(async () => {
  table = await startTable();
});

test.afterAll(async () => {
  await table?.stop();
});

test('the DM creates a bounded scene from the panel and resizes it, with no page errors', async ({
  browser,
}) => {
  if (!table) throw new Error('table not started');
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`${table.clientUrl.replace(/\/$/, '')}/#host=${table.hostToken}`);
  await expect(page.getByRole('status')).toHaveText('Connected to New campaign');

  await page.getByRole('button', { name: 'Scenes' }).click();

  // Defaults are shown in the create form; out-of-range values disable it.
  const width = page.getByLabel('New scene width');
  const height = page.getByLabel('New scene height');
  await expect(width).toHaveValue('40');
  await expect(height).toHaveValue('30');
  await page.getByPlaceholder('New scene name').fill('Bounded');
  await width.fill('201');
  await expect(page.getByRole('button', { name: 'Create scene' })).toBeDisabled();
  await width.fill('20');
  await height.fill('12');
  await page.getByRole('button', { name: 'Create scene' }).click();

  await expect(page.getByRole('listitem').getByText('Bounded', { exact: true })).toBeVisible();
  const canvasWidth = page.getByLabel('Canvas of Bounded width');
  await expect(canvasWidth).toHaveValue('20');
  await expect(page.getByLabel('Canvas of Bounded height')).toHaveValue('12');

  await canvasWidth.fill('25');
  await page.getByRole('button', { name: 'Set size' }).click();
  await expect(page.getByRole('button', { name: 'Set size' })).toBeDisabled();
  await expect(page.getByLabel('Canvas of Bounded width')).toHaveValue('25');

  // Wheel over the board (zoom) and a drag (pan) must not throw.
  const board = page.getByLabel('Scene board');
  await board.scrollIntoViewIfNeeded();
  const box = await board.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -200);
    await page.mouse.down();
    await page.mouse.move(box.x + 50, box.y + 50, { steps: 5 });
    await page.mouse.up();
  }
  expect(errors).toEqual([]);
  await context.close();
});
