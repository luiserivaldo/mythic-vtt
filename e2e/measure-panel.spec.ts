import { expect, test, type Page } from '@playwright/test';
import { RawClient, startTable, testUlid, type Table } from './harness.js';

// UX-18 (UI-MEAS-01..06): the Measure panel opens beside its rail button; every shape is sized by
// dragging with a live readout; right click adds a 2D waypoint or quick-deletes; affected tokens
// are listed in the panel. Label visibility in that list is covered by aoe-highlight.spec (D35).

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
        {
          aoe?: { kind: string; radius?: number; length?: number; size?: number };
        }
      >;
    }
  >;
}

/** The 2D board fits a 40 x 30 scene; map a cell to page pixels from the live canvas box. */
async function cellToPixel(page: Page) {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas box');
  const zoom = Math.min(box.width / 42, box.height / 32);
  return (x: number, z: number) => ({
    x: box.x + box.width / 2 + (x - 20) * zoom,
    y: box.y + box.height / 2 + (z - 15) * zoom,
  });
}

test('the Measure panel opens beside its button and every shape is sized by dragging', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
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
  const host = await RawClient.connect(table, { name: 'measure-panel-host', ...identity });
  try {
    await host.waitFor('host snapshot', () => host.state !== undefined);
    const sceneId = testUlid('SCENE', 1801);
    const tokenId = testUlid('TOKEN', 1801);
    expect((await host.intent('scene.create', { sceneId, name: 'Measure board' })).t).toBe('ack');
    expect(
      (
        await host.intent('entity.create', {
          sceneId,
          entity: {
            id: tokenId,
            layer: 'tokens',
            name: 'Goblin scout',
            owners: [],
            transform: {
              position: { x: 26.5, y: 0, z: 12.5 },
              rotation: { x: 0, y: 0, z: 0, w: 1 },
              scale: { x: 1, y: 1, z: 1 },
            },
            token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
          },
        })
      ).t,
    ).toBe('ack');
    const ownAoE = () => (host.state as Snapshot).scenes[sceneId]?.entities[identity.identityId];

    // UI-MEAS-01: beside the rail button, aligned to it, and never in the right dock.
    const measure = page.getByRole('button', { name: 'Measure', exact: true });
    await measure.click();
    const panel = page.getByRole('complementary', { name: 'Measure', exact: true });
    await expect(panel.getByRole('region', { name: 'Measure tool' })).toBeVisible();
    await expect(
      page.getByRole('complementary', { name: 'Right dock' }).locator('[data-tool-panel="ruler"]'),
    ).toHaveCount(0);
    const rail = await page.getByRole('toolbar', { name: 'Board controls' }).boundingBox();
    const button = await measure.boundingBox();
    const box = await panel.boundingBox();
    if (!rail || !button || !box) throw new Error('missing layout boxes');
    expect(box.x).toBeGreaterThanOrEqual(rail.x + rail.width);
    expect(box.x - (rail.x + rail.width)).toBeLessThan(24);
    // Top-aligned with the button, or moved up only as far as the board needs to fit it.
    expect(box.y).toBeLessThanOrEqual(button.y + 1);
    expect(box.y + box.height).toBeGreaterThan(button.y);

    // UI-MEAS-02/03/04: contents, feet only, and no fixed size inputs or aim control.
    await expect(panel.getByRole('radiogroup', { name: 'Measurement shape' })).toContainText(
      /Ruler\s*Cone\s*Square\s*Circle/,
    );
    for (const label of [
      'Ruler fade',
      'Grid snapping',
      'Always measure token movement',
      'Broadcast to others',
    ])
      await expect(panel.getByLabel(label)).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Clear mine' })).toBeVisible();
    await expect(panel).not.toContainText(/rotation|metre|meter/i);
    await expect(panel.getByLabel('AoE rotation')).toHaveCount(0);

    const at = await cellToPixel(page);
    const origin = at(24.5, 12.5);
    const drag = async (cells: number, readout: string) => {
      const end = at(24.5 + cells, 12.5);
      await page.mouse.move(origin.x, origin.y);
      await page.mouse.down();
      await page.mouse.move(end.x, end.y, { steps: 8 });
      await expect(page.getByTestId('aoe-size-readout')).toHaveText(readout);
      await page.mouse.up();
      await expect(page.getByTestId('aoe-size-readout')).toHaveCount(0);
      await expect(panel.getByRole('region', { name: 'AoE tool' })).toHaveAttribute(
        'aria-busy',
        'false',
      );
    };

    // 2D shapes: cone, square, circle. A cube is centred, so a 2-cell drag makes a 4-cell side.
    await panel.getByRole('radio', { name: 'Cone', exact: true }).check();
    await drag(6, 'Length 30 ft');
    await expect.poll(() => ownAoE()?.aoe).toMatchObject({ kind: 'cone', length: 6 });
    await expect(panel.getByLabel('AoE size')).toHaveValue('30');
    await panel.getByRole('radio', { name: 'Square', exact: true }).check();
    await drag(2, 'Side 20 ft');
    await expect.poll(() => ownAoE()?.aoe).toMatchObject({ kind: 'cube', size: 4 });
    await panel.getByRole('radio', { name: 'Circle', exact: true }).check();
    await drag(3, 'Radius 15 ft');
    await expect.poll(() => ownAoE()?.aoe).toMatchObject({ kind: 'sphere', radius: 3 });

    // UI-MEAS-06: the circle covers the goblin two cells away; the panel lists it (once for the
    // placed circle, and again for the live preview under the pointer).
    const affected = panel.getByRole('region', { name: 'Affected tokens' });
    await expect(affected.getByText('Goblin scout', { exact: true }).first()).toBeVisible();

    // UI-MEAS-05: right click on your own AoE quick-deletes it.
    await page.mouse.click(origin.x, origin.y, { button: 'right' });
    await expect.poll(() => ownAoE()).toBeUndefined();

    // 3D shapes (the 2D board still maps cells to pixels): sphere, cylinder, cone, cube.
    await panel.getByLabel('Measurement mode').selectOption('3d');
    await expect(panel.getByRole('radiogroup', { name: 'Measurement shape' })).toContainText(
      /3D ruler\s*Sphere\s*Cylinder\s*Cone\s*Cube/,
    );
    await panel.getByRole('radio', { name: 'Sphere', exact: true }).check();
    await drag(4, 'Radius 20 ft');
    await expect.poll(() => ownAoE()?.aoe).toMatchObject({ kind: 'sphere', radius: 4 });
    await panel.getByRole('radio', { name: 'Cylinder', exact: true }).check();
    await drag(2, 'Radius 10 ft');
    await expect.poll(() => ownAoE()?.aoe).toMatchObject({ kind: 'cylinder', radius: 2 });
    await panel.getByRole('radio', { name: 'Cone', exact: true }).check();
    await drag(5, 'Length 25 ft');
    await expect.poll(() => ownAoE()?.aoe).toMatchObject({ kind: 'cone', length: 5 });
    await panel.getByRole('radio', { name: 'Cube', exact: true }).check();
    await drag(1, 'Side 10 ft');
    await expect.poll(() => ownAoE()?.aoe).toMatchObject({ kind: 'cube', size: 2 });

    // Clear mine removes this viewer's measuring AoE.
    await panel.getByRole('button', { name: 'Clear mine' }).click();
    await expect.poll(() => ownAoE()).toBeUndefined();

    // The 3D ruler is drag-sized with a live readout, and right click quick-deletes it.
    await panel.getByRole('radio', { name: '3D ruler', exact: true }).check();
    const far = at(30.5, 12.5);
    await panel.getByLabel('Ruler fade').selectOption('linger');
    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    await page.mouse.move(far.x, far.y, { steps: 8 });
    await expect(page.getByTestId('ruler-total')).toHaveText(/(^| )30 ft$/);
    await page.mouse.up();
    await expect(page.getByTestId('ruler-total')).toHaveText(/(^| )30 ft$/);
    // Off the readout label, so the right click lands on the board.
    const aside = at(27.5, 17.5);
    await page.mouse.click(aside.x, aside.y, { button: 'right' });
    await expect(page.getByTestId('ruler-total')).toHaveCount(0);
    await panel.getByLabel('Ruler fade').selectOption('instant');

    // The 2D ruler: right click adds a waypoint and the total keeps adding up.
    await panel.getByLabel('Measurement mode').selectOption('2d');
    await expect(panel.getByRole('radio', { name: 'Ruler', exact: true })).toBeChecked();
    const bend = at(28.5, 12.5);
    const down = at(28.5, 16.5);
    await page.mouse.click(origin.x, origin.y);
    await page.mouse.move(bend.x, bend.y, { steps: 6 });
    await expect(page.getByTestId('ruler-total')).toHaveText('20 ft');
    await page.mouse.click(bend.x, bend.y, { button: 'right' });
    await page.mouse.move(down.x, down.y, { steps: 6 });
    await expect(page.getByTestId('ruler-total')).toHaveText('40 ft');
    await panel.getByRole('button', { name: 'Clear mine' }).click();
    await expect(page.getByTestId('ruler-total')).toHaveCount(0);

    expect(errors).toEqual([]);
  } finally {
    await host.close();
    await context.close();
  }
});
