import { expect, test } from '@playwright/test';
import { RawClient, startTable, testUlid, type Table } from './harness.js';

let table: Table;

test.beforeAll(async () => {
  table = await startTable();
});
test.afterAll(async () => {
  await table.stop();
});

interface Snapshot {
  scenes: Record<
    string,
    {
      entities: Record<
        string,
        { aoe?: { kind: string }; transform: { position: { x: number; z: number } } }
      >;
    }
  >;
}

// M3-14: placement persists, a second placement replaces only this identity, and right-click clears it.
test('the DM replaces and quick-deletes their persistent AoE without page errors', async ({
  browser,
}) => {
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
    const first = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const second = { x: first.x + Math.min(80, box.width / 6), y: first.y };
    const ownAoE = () => (host.state as Snapshot).scenes[sceneId]?.entities[identity.identityId];
    const aoeCount = () =>
      Object.values((host.state as Snapshot).scenes[sceneId]?.entities ?? {}).filter(
        (entity) => entity.aoe !== undefined,
      ).length;
    await page.mouse.click(first.x, first.y);
    await expect.poll(() => ownAoE()?.aoe?.kind).toBe('cone');
    expect(aoeCount()).toBe(1);
    const firstPosition = JSON.stringify(ownAoE()?.transform.position);
    await expect(async () => {
      await page.mouse.click(second.x, second.y);
      await expect
        .poll(() => JSON.stringify(ownAoE()?.transform.position), { timeout: 1_000 })
        .not.toBe(firstPosition);
    }).toPass();
    expect(aoeCount()).toBe(1);
    await page.mouse.click(second.x, second.y, { button: 'right' });
    await expect.poll(() => ownAoE()).toBeUndefined();
    expect(aoeCount()).toBe(0);
    await expect(page.getByRole('status')).toContainText('Connected to');
    expect(errors).toEqual([]);
  } finally {
    await host.close();
    await context.close();
  }
});
