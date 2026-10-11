import { expect, test } from '@playwright/test';
import { RawClient, startTable, testUlid, type Table } from './harness.js';

let table: Table;

test.beforeAll(async () => {
  table = await startTable();
});
test.afterAll(async () => {
  await table.stop();
});

// M3-05 / MEAS-04: use the printed DM link so this follows the real host UI path, then verify
// client-derived affected names follow authoritative AoE state in both render modes.
test('the DM link shows live AoE affected tokens in 2D and 3D', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${table.clientUrl.replace(/\/$/, '')}/#host=${table.hostToken}`);
  await expect(page.getByRole('status')).toHaveText('Connected to New campaign');
  const identity = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('mythic.identity.v1') ?? '{}') as {
        identityId: string;
        identitySecret: string;
      },
  );
  const host = await RawClient.connect(table, { name: 'aoe-highlight-host', ...identity });
  try {
    await host.waitFor('host snapshot', () => host.state !== undefined);
    const sceneId = testUlid('SCENE', 505);
    const insideId = testUlid('TOKEN', 501);
    const outsideId = testUlid('TOKEN', 502);
    const aoeId = identity.identityId;
    const transform = (x: number, y: number, z: number) => ({
      position: { x, y, z },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    });
    expect((await host.intent('scene.create', { sceneId, name: 'Affected board' })).t).toBe('ack');
    for (const entity of [
      {
        id: insideId,
        layer: 'tokens',
        name: 'Inside hero',
        owners: [],
        transform: transform(8, 0, 8),
        token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
      },
      {
        id: outsideId,
        layer: 'tokens',
        name: 'Outside hero',
        owners: [],
        transform: transform(14, 0, 8),
        token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
      },
    ]) {
      expect((await host.intent('entity.create', { sceneId, entity })).t).toBe('ack');
    }
    expect(
      (
        await host.intent('aoe.place', {
          sceneId,
          entity: {
            id: aoeId,
            layer: 'effects',
            name: 'Test sphere',
            owners: [],
            transform: transform(8, 0, 8),
            aoe: { kind: 'sphere', radius: 2, color: '#ff7744' },
          },
        })
      ).t,
    ).toBe('ack');

    // M3-15: AoE controls and affected-token readouts live in the unified Ruler panel.
    await page.getByRole('button', { name: 'Ruler', exact: true }).click();
    await page.getByText('Measurement shapes', { exact: true }).click();
    await page.getByLabel('Measurement shape', { exact: true }).selectOption('sphere');
    const panel = page.getByRole('region', { name: 'Affected tokens' });
    await expect(panel.getByText('Inside hero')).toBeVisible();
    await expect(panel.getByText('Outside hero')).toHaveCount(0);
    await expect(panel).toContainText('1 token');

    expect(
      (
        await host.intent('aoe.update', {
          sceneId,
          entityId: aoeId,
          changes: { transform: transform(14, 0, 8) },
        })
      ).t,
    ).toBe('ack');
    await expect(panel.getByText('Outside hero')).toBeVisible();
    await expect(panel.getByText('Inside hero')).toHaveCount(0);
    await page.screenshot({ path: '/tmp/mythic-m3-05-aoe-highlight-2d.png' });

    const viewToggle = page.getByRole('button', { name: '3D view' });
    await viewToggle.click();
    await expect(panel.getByText('Outside hero')).toBeVisible();
    await expect(viewToggle).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Reset view' }).click();
    await page.waitForTimeout(350);
    await page.screenshot({ path: '/tmp/mythic-m3-12-aoe-highlight-3d.png' });
    expect(errors).toEqual([]);
  } finally {
    await host.close();
    await context.close();
  }
});
