import { expect, test } from '@playwright/test';
import { RawClient, startTable, testUlid, type Table } from './harness.js';

let table: Table;

test.beforeAll(async () => {
  table = await startTable();
});
test.afterAll(async () => {
  await table.stop();
});

// M3-04: the DM places an AoE through the toolbar and board; D23 gates it to host/admin.
test('the DM places an AoE with the tool and the board has no page errors', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${table.clientUrl}/#host=${table.hostToken}`);
  await expect(page.getByRole('status')).toHaveText('Connected to New campaign');
  const identity = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('mythic.identity.v1') ?? '{}') as {
        identityId: string;
        identitySecret: string;
      },
  );
  const host = await RawClient.connect(table, { name: 'aoe-tool-host', ...identity });
  try {
    await host.waitFor('host snapshot', () => host.state !== undefined);
    const sceneId = testUlid('SCENE', 404);
    expect((await host.intent('scene.create', { sceneId, name: 'AoE tool board' })).t).toBe('ack');
    const tool = page.getByRole('region', { name: 'AoE tool' });
    const toggle = tool.getByRole('button', { name: 'AoE placement' });
    await expect(toggle).toBeVisible();
    await toggle.click();
    await tool.getByLabel('AoE shape').selectOption('cone');
    await tool.getByLabel('AoE rotation').fill('90');
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('no canvas');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await expect
      .poll(() => {
        const json = JSON.stringify(host.state);
        return json.includes('"kind":"cone"');
      })
      .toBe(true);
    await expect(page.getByRole('status')).toContainText('Connected to');
    expect(errors).toEqual([]);
  } finally {
    await host.close();
    await context.close();
  }
});
