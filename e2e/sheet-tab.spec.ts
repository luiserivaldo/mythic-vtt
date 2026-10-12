import { expect, test } from '@playwright/test';
import { RawClient, startTable, testUlid, type Table } from './harness.js';

// UX-34 / UI-SHEET-01: the Sheet tab is a placeholder labelled `WIP`, and "See Sheet" on a token
// selects it. No sheet data exists yet (CHAR-01), so nothing but text is rendered.
let table: Table | undefined;

test.beforeAll(async () => {
  table = await startTable();
});
test.afterAll(async () => {
  await table?.stop();
});

test('the Sheet tab is a WIP placeholder and See Sheet on a token selects it', async ({
  browser,
}) => {
  test.setTimeout(60_000);
  if (!table) throw new Error('table not started');
  const identity = { identityId: testUlid('HOST', 1), identitySecret: 'sheet-test-host' };
  const host = await RawClient.connect(table, {
    name: 'DM',
    ...identity,
    hostToken: table.hostToken,
  });
  const sceneId = testUlid('SCENE', 1);
  const entityId = testUlid('TOKEN', 1);
  expect(await host.intent('scene.create', { sceneId, name: 'Sheets' })).toMatchObject({
    t: 'ack',
  });
  expect(await host.intent('scene.activate', { sceneId })).toMatchObject({ t: 'ack' });
  expect(
    await host.intent('entity.create', {
      sceneId,
      entity: {
        id: entityId,
        layer: 'tokens',
        name: 'Hero',
        owners: [],
        transform: {
          position: { x: 20, y: 0, z: 15 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          scale: { x: 1, y: 1, z: 1 },
        },
        token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
      },
    }),
  ).toMatchObject({ t: 'ack' });

  const context = await browser.newContext();
  await context.addInitScript((value) => {
    localStorage.setItem('mythic.identity.v1', JSON.stringify(value));
    localStorage.setItem('mythic.host', '1');
  }, identity);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(table.clientUrl);
  await expect(page.getByRole('status')).toHaveText('Connected to New campaign');

  // The dock opens on Chat; the Sheet tab is a placeholder that holds no sheet data at all.
  const sheetTab = page.getByRole('tab', { name: 'Sheet', exact: true });
  await sheetTab.click();
  const sheet = page.getByRole('region', { name: 'Sheet' });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('WIP');
  await expect(sheet.locator('input, select, table, ul, img, button, canvas')).toHaveCount(0);

  // Back on Chat, the selected token's panel offers "See Sheet", which selects the tab.
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await expect(sheetTab).toHaveAttribute('aria-selected', 'false');
  await page.getByRole('tab', { name: 'Entities', exact: true }).click();
  await page.getByRole('button', { name: 'Hero', exact: true }).click();
  await page.getByRole('button', { name: 'Restore Token panel' }).click();
  await page.getByRole('button', { name: 'See Sheet', exact: true }).click();
  await expect(sheetTab).toHaveAttribute('aria-selected', 'true');
  await expect(sheet).toContainText('WIP');

  // A player is offered the same placeholder tab, and the panel carries no table data for them.
  await page.getByRole('tab', { name: 'Participants', exact: true }).click();
  await page.getByRole('button', { name: 'Add Player' }).click();
  const playerContext = await browser.newContext();
  const player = await playerContext.newPage();
  player.on('pageerror', (error) => errors.push(error.message));
  await player.goto(table.clientUrl);
  await player.getByLabel('Display name').fill('Sheet Player');
  await player.getByRole('button', { name: 'Continue', exact: true }).click();
  await player.getByRole('radio', { name: /Player/ }).check();
  await player.getByRole('button', { name: 'Join participant slot', exact: true }).click();
  await expect(player.getByRole('status')).toHaveText('Connected to New campaign');

  const playerSheetTab = player.getByRole('tab', { name: 'Sheet', exact: true });
  await playerSheetTab.click();
  await expect(player.getByRole('region', { name: 'Sheet' })).toContainText('WIP');
  await expect(player.getByRole('region', { name: 'Entities' })).toHaveCount(0);
  await expect(player.getByRole('region', { name: 'Layers' })).toHaveCount(0);

  expect(errors).toEqual([]);
  await playerContext.close();
  await context.close();
  await host.close();
});
