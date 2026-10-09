import { expect, test } from '@playwright/test';
import { connectAoEPlacer } from './aoe-fixture.js';
import { RawClient, startTable, testUlid, type Table } from './harness.js';

let table: Table;

test.beforeAll(async () => {
  table = await startTable();
});
test.afterAll(async () => {
  await table.stop();
});

test('host board renders received AoEs, hides the effects layer, and survives 2D/3D toggle', async ({
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
  const host = await RawClient.connect(table, { name: 'aoe-host', ...identity });
  const placers: RawClient[] = [];
  try {
    await host.waitFor('host snapshot', () => host.state !== undefined);
    const sceneId = testUlid('SCENE', 303);
    expect((await host.intent('scene.create', { sceneId, name: 'AoE board' })).t).toBe('ack');
    const transform = (x: number, y: number, z: number) => ({
      position: { x, y, z },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    });
    expect(
      (
        await host.intent('entity.create', {
          sceneId,
          entity: {
            id: testUlid('PLATFORM', 1),
            layer: 'props',
            name: 'Platform',
            owners: [],
            transform: { ...transform(10, 0, 8), scale: { x: 5, y: 1, z: 5 } },
            shape: { kind: 'box', color: '#556677', walkable: true },
          },
        })
      ).t,
    ).toBe('ack');
    const shapes = [
      { kind: 'sphere', radius: 2.5, color: '#ff5533' },
      { kind: 'cylinder', radius: 2, height: 3, color: '#33ccff' },
      { kind: 'cone', radius: 2, length: 5, color: '#ffcc33' },
      { kind: 'cube', size: 3, color: '#cc66ff' },
      { kind: 'line', width: 1.5, height: 2, length: 5, color: '#55ff77' },
    ];
    for (const [i, aoe] of shapes.entries()) {
      const placer = await connectAoEPlacer(table, host, testUlid('AOE', i + 1), i + 1);
      placers.push(placer);
      expect(
        (
          await placer.intent('aoe.place', {
            sceneId,
            entity: {
              id: testUlid('AOE', i + 1),
              layer: 'effects',
              name: aoe.kind,
              owners: [],
              transform: transform(5 + i * 5, i === 0 ? 0.5 : 0, 8),
              aoe,
            },
          })
        ).t,
      ).toBe('ack');
    }
    await expect(page.getByRole('status')).toContainText('Connected to');
    await page.waitForTimeout(350);
    const canvas = page.locator('canvas');
    const shown = await canvas.screenshot({ path: '/tmp/mythic-m3-03-aoe-2d.png' });
    expect(
      (
        await host.intent('aoe.update', {
          sceneId,
          entityId: testUlid('AOE', 1),
          changes: {
            transform: transform(5, 0.5, 12),
          },
        })
      ).t,
    ).toBe('ack');
    await expect.poll(async () => (await canvas.screenshot()).equals(shown)).toBe(false);
    const moved = await canvas.screenshot();
    expect((await host.intent('aoe.remove', { sceneId, entityId: testUlid('AOE', 5) })).t).toBe(
      'ack',
    );
    await expect.poll(async () => (await canvas.screenshot()).equals(moved)).toBe(false);
    await page.getByRole('button', { name: 'Layers', exact: true }).click();
    await page
      .getByRole('listitem')
      .filter({ hasText: 'Effects' })
      .getByLabel('Hidden (this screen only)')
      .check();
    const hidden = await canvas.screenshot();
    expect(hidden.equals(moved)).toBe(false);
    await page
      .getByRole('listitem')
      .filter({ hasText: 'Effects' })
      .getByLabel('Hidden (this screen only)')
      .uncheck();
    await page.getByRole('button', { name: /3D/i }).click();
    await page.waitForTimeout(450);
    await canvas.screenshot({ path: '/tmp/mythic-m3-03-aoe-3d.png' });
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(placers.map((placer) => placer.close()));
    await host.close();
    await context.close();
  }
});
