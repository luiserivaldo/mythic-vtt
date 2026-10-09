import { Campaign } from '../packages/shared/src/index.js';
import { expect, test, type Page } from '@playwright/test';
import { RawClient, openClient, startTable, testUlid, type Table } from './harness.js';

async function ringCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (globalThis as unknown as { __mythicRender?: { getObjectNames(): string[] } }).__mythicRender
        ?.getObjectNames()
        .filter((name) => name.startsWith('token-ring-')).length ?? 0,
  );
}
let table: Table | undefined;
test.beforeAll(async () => {
  table = await startTable();
});
test.afterAll(async () => {
  await table?.stop();
});

test('ring controls synchronize in scene units and survive 2D/3D and reload', async ({
  browser,
}) => {
  if (!table) throw new Error('table not started');
  const identity = { identityId: testUlid('HOST', 1), identitySecret: 'ring-test-host' };
  const setup = await RawClient.connect(table, {
    name: 'DM',
    ...identity,
    hostToken: table.hostToken,
  });
  const sceneId = testUlid('SCENE', 1);
  const entityId = testUlid('TOKEN', 1);
  expect(await setup.intent('scene.create', { sceneId, name: 'Rings' })).toMatchObject({
    t: 'ack',
  });
  expect(await setup.intent('scene.activate', { sceneId })).toMatchObject({ t: 'ack' });
  expect(
    await setup.intent('entity.create', {
      sceneId,
      entity: {
        id: entityId,
        layer: 'tokens',
        name: 'Hero',
        owners: [],
        transform: {
          position: { x: 20, y: 2, z: 15 },
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
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page.getByRole('button', { name: 'Hero', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Token rings' });
  await panel.getByLabel('Ring radius (ft)').fill('10');
  await panel.getByRole('button', { name: 'Add ring' }).click();
  await expect(panel.getByRole('list')).toContainText('10 ft');
  await expect.poll(() => ringCount(page)).toBe(1);
  await setup.waitFor(
    'ring applied',
    () =>
      Campaign.safeParse(setup.state).data?.scenes[sceneId]?.entities[entityId]?.token?.rings?.[0]
        ?.radius === 10,
  );
  const spectator = await openClient(browser, table, 'spectator');
  await expect(spectator.page.getByTestId('token-label')).toContainText('Hero');
  await expect.poll(() => ringCount(spectator.page)).toBe(1);
  await page.getByRole('button', { name: '3D view' }).click();
  await spectator.page.getByRole('button', { name: '3D view' }).click();
  await expect(page.getByRole('button', { name: 'Reset view' })).toBeVisible();
  await expect.poll(() => ringCount(page)).toBe(1);
  await expect.poll(() => ringCount(spectator.page)).toBe(1);
  await expect(panel.getByRole('list')).toContainText('10 ft');
  await page.getByRole('button', { name: '3D view' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page.getByRole('button', { name: 'Hero', exact: true }).click();
  await expect(panel.getByRole('list')).toContainText('10 ft');
  await panel.getByRole('button', { name: 'Remove ring 1' }).click();
  await expect(panel.getByRole('listitem')).toHaveCount(0);
  await expect.poll(() => ringCount(spectator.page)).toBe(0);
  expect(errors).toEqual([]);
  await spectator.context.close();
  await context.close();
  await setup.close();
});
