import { expect, test } from '@playwright/test';
import { RawClient, startTable, testUlid, type Table } from './harness.js';

// UX-21 (UI-TOKEN-06, MEAS-01/Q31, §10 C4): while a token is dragged with "Always measure token
// movement" on, a left click commits a checkpoint and the drag keeps measuring from it, cumulatively
// in scene units with the diagonal rule. The ruler tool keeps its own right-click waypoints.

let table: Table | undefined;

test.beforeAll(async () => {
  table = await startTable();
});

test.afterAll(async () => {
  await table?.stop();
});

interface Snapshot {
  scenes: Record<
    string,
    { entities: Record<string, { transform: { position: { x: number; y: number; z: number } } }> }
  >;
}

test('a left click while dragging a token commits a checkpoint and the total stays cumulative', async ({
  browser,
}, testInfo) => {
  if (!table) throw new Error('table not started');
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${table.clientUrl.replace(/\/$/, '')}/?dev=1#host=${table.hostToken}`);
  await expect(page.getByRole('status')).toHaveText('Connected to New campaign');
  await expect(page.getByRole('complementary', { name: 'Developer diagnostics' })).toBeVisible();
  await page.getByRole('button', { name: 'Close developer diagnostics' }).click();

  const identity = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('mythic.identity.v1') ?? '{}') as {
        identityId: string;
        identitySecret: string;
      },
  );
  const host = await RawClient.connect(table, { name: 'checkpoint host', ...identity });
  await host.waitFor('host snapshot', () => host.state !== undefined);
  const sceneId = testUlid('SCENE', 31);
  const tokenId = testUlid('TOKEN', 31);
  expect((await host.intent('scene.create', { sceneId, name: 'Checkpoints' })).t).toBe('ack');
  expect((await host.intent('scene.activate', { sceneId })).t).toBe('ack');
  expect(
    (
      await host.intent('entity.create', {
        sceneId,
        entity: {
          id: tokenId,
          layer: 'tokens',
          name: 'Goblin',
          owners: [],
          transform: {
            position: { x: 5.5, y: 0, z: 5.5 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
          },
          token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
        },
      })
    ).t,
  ).toBe('ack');

  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId('token-label')).toHaveText('Goblin');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas box');
  const zoom = Math.min(box.width / 42, box.height / 32);
  const at = (x: number, z: number) => ({
    x: box.x + box.width / 2 + (x - 20) * zoom,
    y: box.y + box.height / 2 + (z - 15) * zoom,
  });

  const start = at(5.5, 5.5);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const east = at(8.5, 5.5);
  await page.mouse.move(east.x, east.y, { steps: 6 });
  await expect(page.getByTestId('drag-ruler-total')).toHaveText('15 ft');

  // A left click while the button is held still reaches the canvas, so it commits a checkpoint.
  await page.mouse.down();
  const south = at(8.5, 8.5);
  await page.mouse.move(south.x, south.y, { steps: 6 });
  // Three cells east then three cells south: two 15 ft legs, not the 15 ft straight line.
  await expect(page.getByTestId('drag-ruler-segment')).toHaveText(['15 ft', '15 ft']);
  await expect(page.getByTestId('drag-ruler-total')).toHaveText('30 ft');
  await page.screenshot({ path: testInfo.outputPath('drag-checkpoint.png') });

  await page.mouse.up();
  await expect(page.getByTestId('drag-ruler-total')).toHaveCount(0);

  const position = () =>
    (host.state as Snapshot).scenes[sceneId]?.entities[tokenId]?.transform.position;
  await expect.poll(() => position()?.x, { timeout: 10_000 }).toBeCloseTo(8.5);
  expect(position()?.z).toBeCloseTo(8.5);
  expect(position()?.y).toBe(0);
  expect(errors).toEqual([]);

  await host.close();
  await context.close();
});
