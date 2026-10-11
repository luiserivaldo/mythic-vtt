import { expect, test } from '@playwright/test';
import { openClient, startTable, type Table } from './harness.js';

let table: Table | undefined;
test.beforeAll(async () => {
  table = await startTable();
});
test.afterAll(async () => {
  await table?.stop();
});

test('identity backup transfers an occupied seat to another browser without uploading the file', async ({
  browser,
}, testInfo) => {
  if (!table) throw new Error('table not started');
  const dmContext = await browser.newContext();
  const dm = await dmContext.newPage();
  await dm.goto(`${table.clientUrl.replace(/\/$/, '')}/#host=${table.hostToken}`);
  await expect(dm.getByRole('status')).toHaveText('Connected to New campaign');
  await dm.getByRole('button', { name: 'Seats', exact: true }).click();
  await dm.getByPlaceholder('New seat name').fill('Wizard');
  await dm.getByRole('button', { name: 'Add seat' }).click();
  const first = await openClient(browser, table, 'original', { joinScreen: true });
  await first.page.getByLabel('Display name').fill('Alice');
  await first.page.getByRole('button', { name: 'Continue' }).click();
  await first.page.getByRole('radio', { name: /Wizard/ }).check();
  await first.page.getByRole('button', { name: 'Join seat', exact: true }).click();
  await expect(first.page.getByRole('dialog')).toHaveCount(0);
  await first.page.getByText('Identity backup and transfer', { exact: true }).click();
  await expect(first.page.getByText(/This file contains your identity secret/)).toBeVisible();
  const downloadEvent = first.page.waitForEvent('download');
  await first.page.getByRole('button', { name: 'Download identity backup' }).click();
  const backup = testInfo.outputPath('identity.json');
  await (await downloadEvent).saveAs(backup);
  const expectedIdentity = await first.page.evaluate(() =>
    localStorage.getItem('mythic.identity.v1'),
  );

  const second = await openClient(browser, table, 'destination', { joinScreen: true });
  await second.page.getByText('Identity backup and transfer', { exact: true }).click();
  const before = await second.page.evaluate(() => localStorage.getItem('mythic.identity.v1'));
  const uploads: string[] = [];
  second.page.on('request', (request) => {
    if (request.method() !== 'GET') uploads.push(request.method());
  });
  await second.page.getByLabel('Identity file', { exact: true }).setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{broken'),
  });
  await expect(second.page.getByRole('alert')).toHaveText(
    'This is not a valid Mythic identity file.',
  );
  expect(
    (await second.page.evaluate(() => localStorage.getItem('mythic.identity.v1'))) === before,
  ).toBe(true);
  await second.page.getByLabel('Identity file', { exact: true }).setInputFiles(backup);
  await expect(
    second.page.getByRole('button', { name: 'Replace identity and reload' }),
  ).toBeVisible();
  await second.page.getByRole('button', { name: 'Replace identity and reload' }).click();
  await expect(second.page.getByLabel('Display name')).toBeVisible();
  expect(
    await second.page.evaluate((expected) => {
      const current: unknown = JSON.parse(localStorage.getItem('mythic.identity.v1') ?? 'null');
      const original: unknown = JSON.parse(expected ?? 'null');
      return JSON.stringify(current) === JSON.stringify(original);
    }, expectedIdentity),
  ).toBe(true);
  await second.page.getByLabel('Display name').fill('Alice transferred');
  await second.page.getByRole('button', { name: 'Continue' }).click();
  await expect(second.page.getByRole('dialog')).toHaveCount(0);
  await expect(second.page.getByLabel('Current identity')).toContainText('Wizard');
  await expect(second.page.getByLabel('Current identity')).toContainText('Player');
  expect(uploads).toEqual([]);
  await first.context.close();
  await second.context.close();
  await dmContext.close();
});
