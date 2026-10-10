import { expect, test } from '@playwright/test';
import { RawClient, startTable, testUlid } from './harness.js';

test('DM selects, moves and resizes a rectangular battlemap using its real bounds', async ({
  browser,
}) => {
  const table = await startTable();
  const identity = { identityId: testUlid('HOST', 142), identitySecret: 'map-transform-test' };
  const host = await RawClient.connect(table, {
    name: 'map-host',
    ...identity,
    hostToken: table.hostToken,
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  try {
    await host.waitFor('snapshot', () => host.state !== undefined);
    const sceneId = testUlid('SCENE', 142);
    const entityId = testUlid('MAP', 142);
    expect(await host.intent('scene.create', { sceneId, name: 'Rectangular map' })).toMatchObject({
      t: 'ack',
    });
    expect(
      await host.intent('entity.create', {
        sceneId,
        entity: {
          id: entityId,
          name: 'Wide map',
          layer: 'map',
          owners: [],
          transform: {
            position: { x: 20, y: 0, z: 15 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 4, y: 4, z: 4 },
          },
          image: {
            asset: { source: 'local', hash: 'b'.repeat(64), kind: 'image' },
            calibrated: true,
          },
        },
      }),
    ).toMatchObject({ t: 'ack' });
    await context.addInitScript((saved) => {
      localStorage.setItem('mythic.identity.v1', JSON.stringify(saved));
      localStorage.setItem('mythic.host', '1');
    }, identity);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let imageLoaded = false;
    await page.route(`**/assets/${'b'.repeat(64)}*`, async (route) => {
      await route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#9a7355"/></svg>',
      });
      imageLoaded = true;
    });
    await page.goto(table.clientUrl);
    await expect(page.getByRole('status')).toHaveText('Connected to New campaign');
    await expect.poll(() => imageLoaded).toBe(true);
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('missing canvas');
    const zoom = Math.min(box.width / 42, box.height / 32);
    const at = (x: number, z: number) => ({
      x: box.x + box.width / 2 + (x - 20) * zoom,
      y: box.y + box.height / 2 + (z - 15) * zoom,
    });
    const panel = page.getByRole('region', { name: 'Transform: Wide map' });
    // Select at the wide edge: outside a square placeholder, inside the loaded image.
    await expect(async () => {
      const point = at(23, 15);
      await page.mouse.click(point.x, point.y);
      await expect(panel).toBeVisible({ timeout: 1000 });
    }).toPass();
    const position = () =>
      (
        host.state as {
          scenes: Record<
            string,
            {
              entities: Record<
                string,
                { transform: { position: { x: number; z: number }; scale: { x: number } } }
              >;
            }
          >;
        }
      ).scenes[sceneId]?.entities[entityId]?.transform;
    const center = at(20, 15);
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x + 2 * zoom, center.y, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => position()?.position.x).toBeCloseTo(22);
    // Gizmo bounds use the texture's 2:1 aspect: width 8 cells, half extent 4.
    const moved = at(22, 15);
    const offset = 4 * zoom + 14;
    await page.mouse.move(moved.x + offset, moved.y + offset);
    await page.mouse.down();
    await page.mouse.move(moved.x + offset * 1.5, moved.y + offset * 1.5, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => position()?.scale.x).toBeCloseTo(6);
    await expect(panel.getByLabel('Scale', { exact: true })).toHaveValue('6');
    await panel.getByLabel('Scale', { exact: true }).fill('3');
    await panel.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect.poll(() => position()?.scale.x).toBe(3);
    await panel.getByLabel(/^X/).fill('105');
    await panel.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect.poll(() => position()?.position.x).toBe(21);
    await page.getByRole('button', { name: '3D view' }).click();
    await expect(canvas).toBeVisible();
    await page.getByRole('button', { name: '3D view' }).click();
    await expect(panel).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await host.close();
    await table.stop();
  }
});
