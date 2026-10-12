import { expect, test } from '@playwright/test';
import { openClient, startTable, type Table } from './harness.js';

// M1-45 (MEAS-08/Q31): while a 2D ruler is measuring, a right click commits a waypoint and the
// measurement keeps accumulating from it instead of clearing the ruler.
let table: Table | undefined;

test.beforeAll(async () => {
  table = await startTable();
});

test.afterAll(async () => {
  await table?.stop();
});

function cellToPixel(box: { x: number; y: number; width: number; height: number }) {
  const zoom = Math.min(box.width / 42, box.height / 32);
  return (x: number, z: number) => ({
    x: box.x + box.width / 2 + (x - 20) * zoom,
    y: box.y + box.height / 2 + (z - 15) * zoom,
  });
}

test('a right click commits a 2D waypoint and the total stays cumulative', async ({
  browser,
}, testInfo) => {
  if (!table) throw new Error('table not started');
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto(`${table.clientUrl.replace(/\/$/, '')}/#host=${table.hostToken}`);
  await expect(page.getByRole('status')).toHaveText('Connected to New campaign');
  await page.getByRole('button', { name: 'Scenes', exact: true }).click();
  await page.getByLabel('New scene name').fill('Waypoints');
  await page.getByRole('button', { name: 'Create scene' }).click();
  await expect(page.getByText('Active', { exact: true })).toBeVisible();

  // A second client proves the bent path, not just the total, travels over the wire.
  const viewer = await openClient(browser, table, 'viewer');
  viewer.page.on('pageerror', (error) => errors.push(error.message));
  await expect(viewer.page.locator('canvas')).toBeVisible();

  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas box');
  const at = cellToPixel(box);
  const a = at(5.5, 5.5);
  const b = at(11.5, 5.5);
  const c = at(11.5, 8.5);
  const d = at(14.5, 8.5);

  await page.getByRole('button', { name: 'Ruler', exact: true }).click();
  await page.mouse.click(a.x, a.y);
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await expect(page.getByTestId('ruler-total')).toHaveText('30 ft');

  // The right click lands on the live end: the 30 ft leg stays and no duplicate point is added, so
  // there is still exactly one segment and no segment label.
  await page.mouse.click(b.x, b.y, { button: 'right' });
  await expect(page.getByTestId('ruler-total')).toHaveText('30 ft');
  await expect(page.getByTestId('ruler-segment')).toHaveCount(0);

  await page.mouse.move(c.x, c.y, { steps: 5 });
  // Six cells east then three cells south sums to 45 ft, not the 35 ft straight line from the start.
  await expect(page.getByTestId('ruler-total')).toHaveText('45 ft');
  await expect(page.getByTestId('ruler-segment')).toHaveText(['30 ft', '15 ft']);
  await expect(viewer.page.getByTestId('remote-ruler-total')).toHaveText('DM: 45 ft');

  // A second right click keeps accumulating instead of replacing the first leg.
  await page.mouse.click(c.x, c.y, { button: 'right' });
  await page.mouse.move(d.x, d.y, { steps: 5 });
  await expect(page.getByTestId('ruler-total')).toHaveText('60 ft');
  await expect(page.getByTestId('ruler-segment')).toHaveText(['30 ft', '15 ft', '15 ft']);
  await expect(viewer.page.getByTestId('remote-ruler-total')).toHaveText('DM: 60 ft');
  await page.screenshot({ path: testInfo.outputPath('ruler-waypoints.png') });

  // Finishing keeps the multi-waypoint readout; a right click then still clears it (M1-41).
  await page.getByLabel('Scene board').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('ruler-total')).toHaveText('60 ft');
  await page.mouse.click(d.x, d.y, { button: 'right' });
  await expect(page.getByTestId('ruler-total')).toHaveCount(0);
  await expect(viewer.page.getByTestId('remote-ruler-total')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ruler', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  expect(errors).toEqual([]);
  await viewer.context.close();
  await context.close();
});
