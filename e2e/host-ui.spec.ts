import { expect, test } from '@playwright/test';
import { openClient, startTable, type Table } from './harness.js';

// D24/D33: the DM link (`#host=<token>`) must make the browser the host and reveal the DM panels.
// This path once crashed with "Maximum call stack size exceeded" (setHost re-entered its own
// store subscription), and nothing caught it because every other e2e client is a viewer.
let table: Table | undefined;

test.beforeAll(async () => {
  table = await startTable();
});

test.afterAll(async () => {
  await table?.stop();
});

test('the DM link makes the browser host: panels appear, the token leaves the URL, no page errors', async ({
  browser,
}) => {
  if (!table) throw new Error('table not started');
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`${table.clientUrl.replace(/\/$/, '')}/#host=${table.hostToken}`);
  await expect(page.getByRole('status')).toHaveText('Connected to New campaign');
  for (const panel of ['Scenes', 'Layers', 'Map', 'Seats']) {
    await expect(page.getByText(panel, { exact: true }).first()).toBeVisible();
  }
  expect(page.url()).not.toContain('host=');
  expect(await page.evaluate(() => localStorage.getItem('mythic.host'))).toBe('1');

  // A plain visitor on the same table is not the host and gets no DM panels.
  const viewer = await openClient(browser, table, 'viewer');
  await expect(viewer.page.getByRole('status')).toHaveText('Connected to New campaign');
  await expect(viewer.page.getByText('Seats', { exact: true })).toHaveCount(0);

  expect(errors).toEqual([]);
  await viewer.context.close();
  await context.close();
});
