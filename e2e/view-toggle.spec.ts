import { expect, test } from '@playwright/test';
import { startTable, type Table } from './harness.js';

// M2-05: the 2D <-> 3D toggle is per-client view state. Toggling swaps the camera (the 3D-only
// "Reset view" control appears), the `3` shortcut does the same, and neither raises page errors.
let table: Table | undefined;

test.beforeAll(async () => {
  table = await startTable();
});

test.afterAll(async () => {
  await table?.stop();
});

test('the host toggles 2D <-> 3D from the toolbar and the 3 key without errors', async ({
  browser,
}) => {
  if (!table) throw new Error('table not started');
  const context = await browser.newContext({ viewport: { width: 1000, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`${table.clientUrl.replace(/\/$/, '')}/#host=${table.hostToken}`);
  await expect(page.getByRole('status')).toHaveText('Connected to New campaign');
  await page.getByRole('button', { name: 'Scenes', exact: true }).click();
  await page.getByPlaceholder('New scene name').fill('Keep');
  await page.getByRole('button', { name: 'Create scene' }).click();
  await expect(page.getByText('Active', { exact: true })).toBeVisible();
  // A gradient background so the 3D skybox is exercised too.
  await page.getByLabel('Background (horizon)').fill('#203040');
  await page.getByLabel('3D gradient').check();
  await page.getByRole('button', { name: 'Set background' }).click();

  const toggle = page.getByRole('button', { name: '3D view' });
  const reset = page.getByRole('button', { name: 'Reset view' });
  await expect(page.locator('canvas')).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(reset).toHaveCount(0);
  if (process.env.VIEW_TOGGLE_SHOTS) {
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${process.env.VIEW_TOGGLE_SHOTS}/2d.png` });
  }

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(reset).toBeVisible();
  if (process.env.VIEW_TOGGLE_SHOTS) {
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${process.env.VIEW_TOGGLE_SHOTS}/3d.png` });
    // Tilt towards the horizon so the sky gradient is in frame.
    const box = await page.locator('canvas').boundingBox();
    if (box) {
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down({ button: 'right' });
      await page.mouse.move(cx, cy + 90, { steps: 6 });
      await page.mouse.up({ button: 'right' });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${process.env.VIEW_TOGGLE_SHOTS}/3d-tilted.png` });
    }
  }

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(reset).toHaveCount(0);
  await page.waitForTimeout(400);
  await expect(page.locator('canvas')).toBeVisible();

  // Keyboard shortcut, from the board (not from a text field).
  await page.getByLabel('Scene board').focus();
  await page.keyboard.press('3');
  await expect(reset).toBeVisible();
  await page.waitForTimeout(400);
  await page.keyboard.press('3');
  await expect(reset).toHaveCount(0);
  // Typing a 3 in a text field must not toggle.
  await page.getByPlaceholder('New scene name').fill('3');
  await expect(reset).toHaveCount(0);

  expect(errors).toEqual([]);
  await context.close();
});
