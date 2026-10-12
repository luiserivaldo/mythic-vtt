import { expect, test } from '@playwright/test';
import { RawClient, startTable, testUlid } from './harness.js';

test('segmented view controls retain selection, tool and camera focus; reset works in 2D', async ({
  browser,
}) => {
  const table = await startTable();
  const context = await browser.newContext();
  const page = await context.newPage();
  let setup: RawClient | undefined;
  try {
    await page.goto(`${table.clientUrl}/#host=${table.hostToken}`);
    await expect(page.getByRole('status')).toHaveText('Connected to New campaign');
    const identity = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('mythic.identity.v1') ?? '{}') as {
          identityId: string;
          identitySecret: string;
        },
    );
    setup = await RawClient.connect(table, { name: 'top-bar-setup', ...identity });
    await setup.waitFor('snapshot', () => setup?.state !== undefined);
    const sceneId = (setup.state as { activeSceneId: string }).activeSceneId;
    expect(
      await setup.intent('entity.create', {
        sceneId,
        entity: {
          id: testUlid('TOKEN', 197),
          name: 'Focus token',
          layer: 'tokens',
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
    await page.getByRole('tab', { name: 'Entities', exact: true }).click();
    const selected = page.getByRole('button', { name: 'Focus token', exact: true });
    await selected.click();
    await expect(selected).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Ruler', exact: true }).click();
    const ruler = page.getByRole('button', { name: 'Ruler', exact: true });
    await expect(ruler).toHaveAttribute('aria-pressed', 'true');
    await expect(selected).toHaveAttribute('aria-pressed', 'true');
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas has no box');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 8 });
    await page.mouse.up({ button: 'middle' });
    await page.getByRole('button', { name: '3D view' }).click();
    const pose = () =>
      page.evaluate(() => {
        const scope = window as unknown as {
          __mythicCamera?: { getPose(): { targetX: number; targetZ: number } };
        };
        return scope.__mythicCamera?.getPose();
      });
    await expect.poll(pose).toBeDefined();
    // Wait for the switch tween; the camera's ground focus does not change during it.
    const focus = await pose();
    await page.getByRole('button', { name: '2D view' }).click();
    await expect.poll(pose).toBeUndefined();
    await expect(ruler).toHaveAttribute('aria-pressed', 'true');
    await expect(selected).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: '3D view' }).click();
    await expect.poll(async () => (await pose())?.targetX).toBeCloseTo(focus?.targetX ?? -1, 4);
    await expect.poll(async () => (await pose())?.targetZ).toBeCloseTo(focus?.targetZ ?? -1, 4);
    await page.getByRole('button', { name: '2D view' }).click();
    await expect.poll(pose).toBeUndefined();
    await page.getByRole('button', { name: 'Reset view' }).click();
    await page.getByRole('button', { name: '3D view' }).click();
    // The default blank scene is 40 by 30 cells; reset frames its centre.
    await expect.poll(async () => (await pose())?.targetX).toBeCloseTo(20, 4);
    await expect.poll(async () => (await pose())?.targetZ).toBeCloseTo(15, 4);
    await expect(ruler).toHaveAttribute('aria-pressed', 'true');
    await expect(selected).toHaveAttribute('aria-pressed', 'true');
  } finally {
    await setup?.close();
    await context.close();
    await table.stop();
  }
});
