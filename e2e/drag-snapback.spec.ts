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
  scenes: Record<string, { entities: Record<string, { transform: { position: Position } }> }>;
}
interface Position {
  x: number;
  y: number;
  z: number;
}

// One entity at a time avoids overlapping token meshes and gives each case an unambiguous pick.
const cases = [
  { size: 0.5, elevation: 0, layer: 'tokens', owned: false, at: { x: 5.5, z: 5.5 } },
  { size: 1, elevation: 0, layer: 'tokens', owned: true, at: { x: 7.5, z: 7.5 } },
  { size: 2, elevation: 10, layer: 'props', owned: false, at: { x: 10, z: 10 } },
  { size: 3, elevation: 0, layer: 'map', owned: true, at: { x: 13.5, z: 13.5 } },
  { size: 4, elevation: 10, layer: 'dm', owned: false, at: { x: 18, z: 18 } },
  { size: 1, elevation: 0, layer: 'tokens', owned: false, at: { x: 37.5, z: 25.5 } },
  { size: 4, elevation: 0, layer: 'tokens', owned: true, at: { x: 36, z: 24 } },
] as const;

test('DM link drags every token size, elevation, layer, ownership and edge spawn', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${table.clientUrl.replace(/\/$/, '')}/?dev=1#host=${table.hostToken}`);
  await expect(page.getByRole('status')).toHaveText('Connected to New campaign');
  const identity = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('mythic.identity.v1') ?? '{}') as {
        identityId: string;
        identitySecret: string;
      },
  );
  const host = await RawClient.connect(table, { name: 'matrix host', ...identity });
  await host.waitFor('host snapshot', () => host.state !== undefined);
  const sceneId = testUlid('SCENE', 27);
  const seatId = testUlid('SEAT', 27);
  expect((await host.intent('scene.create', { sceneId, name: 'Drag matrix' })).t).toBe('ack');
  expect((await host.intent('scene.activate', { sceneId })).t).toBe('ack');
  expect((await host.intent('seat.create', { seatId, label: 'Owner' })).t).toBe('ack');
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('missing canvas');
  const zoom = Math.min(box.width / 42, box.height / 32);
  const screen = (x: number, z: number) => ({
    x: box.x + box.width / 2 + (x - 20) * zoom,
    y: box.y + box.height / 2 + (z - 15) * zoom,
  });

  for (const [index, entry] of cases.entries()) {
    const id = testUlid('TOKEN', index + 27);
    const from = { x: entry.at.x, y: entry.elevation, z: entry.at.z };
    const name = `Matrix ${String(index)}`;
    const created = await host.intent('entity.create', {
      sceneId,
      entity: {
        id,
        layer: entry.layer,
        name,
        owners: entry.owned ? [seatId] : [],
        transform: {
          position: from,
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          scale: { x: 1, y: 1, z: 1 },
        },
        token: { sizeCells: entry.size, heightCells: 1, labelVisibility: 'all' },
      },
    });
    expect(created.t, `${name} create: ${created.reason ?? ''}`).toBe('ack');
    await expect(page.getByTestId('token-label').filter({ hasText: name })).toBeVisible();
    const start = screen(from.x, from.z);
    const panel = page.getByRole('region', { name: /Transform/ });
    await expect(async () => {
      await page.mouse.click(start.x, start.y);
      await expect(panel).toBeVisible({ timeout: 1000 });
    }).toPass();
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x - zoom, start.y, { steps: 5 });
    await page.mouse.move(start.x - 2 * zoom, start.y, { steps: 5 });
    await page.mouse.up();
    const position = () => (host.state as Snapshot).scenes[sceneId]?.entities[id]?.transform.position;
    await expect.poll(() => position()?.x, { message: name, timeout: 5_000 }).toBeCloseTo(from.x - 2);
    expect(position()?.z, name).toBeCloseTo(from.z);
    expect(errors, name).toEqual([]);
    expect((await host.intent('entity.delete', { sceneId, entityId: id })).t).toBe('ack');
    await expect(page.getByTestId('token-label').filter({ hasText: name })).toHaveCount(0);
  }
  await host.close();
  await context.close();
});
