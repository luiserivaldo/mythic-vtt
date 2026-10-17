import { expect, test } from '@playwright/test';
import { RawClient, startTable, testUlid, type Table } from './harness.js';

// MV-267 (MV-279): the left pane floats over the board's left edge. Arming Measure tucks it to its
// strip so a ruler or AoE drag aimed at the cells it covered reaches the board; putting Measure
// away reopens it, and expanding it while measuring keeps its controls clickable.

let table: Table;

test.beforeAll(async () => {
  table = await startTable();
});

test.afterAll(async () => {
  await table.stop();
});

interface Snapshot {
  scenes: Record<string, { entities: Record<string, { aoe?: { kind: string } }> }>;
}

test('ruler and AoE drags start on cells an open left pane covered', async ({ browser }) => {
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
  const host = await RawClient.connect(table, { name: 'measure-pane-host', ...identity });
  try {
    await host.waitFor('host snapshot', () => host.state !== undefined);
    const sceneId = testUlid('PANE-SCENE', 1);
    expect((await host.intent('scene.create', { sceneId, name: 'Measure under pane' })).t).toBe(
      'ack',
    );
    expect((await host.intent('scene.activate', { sceneId })).t).toBe('ack');
    await page.getByRole('tab', { name: 'Entities', exact: true }).click();
    const list = page.getByRole('list', { name: 'Entities in this scene' });
    await page.getByLabel('Token name').fill('Goblin');
    await page.getByRole('button', { name: 'Create token' }).click();
    await list.getByRole('button', { name: 'Goblin', exact: true }).click();

    const pane = page.getByRole('complementary', { name: 'Left pane' });
    const transform = pane.locator('[data-tool-panel="transform"]');
    await expect(transform.getByRole('region', { name: 'Transform: Goblin' })).toBeVisible();
    const board = await page.locator('canvas').boundingBox();
    const open = await pane.boundingBox();
    if (!board || !open) throw new Error('no board or pane box');
    // A board cell well inside the open pane, right of where its collapsed strip sits.
    const under = { x: open.x + open.width * 0.6, y: open.y + open.height * 0.5 };
    expect(under.x).toBeGreaterThan(board.x);
    expect(under.y).toBeGreaterThan(board.y);

    // Ruler: arming Measure collapses the pane; the drag from under it measures.
    await page.getByRole('button', { name: 'Measure', exact: true }).click();
    await page.getByLabel('Ruler fade').selectOption('linger');
    await page.getByRole('button', { name: 'Close Measure panel' }).click();
    await page.mouse.move(under.x, under.y);
    await page.mouse.down();
    await page.mouse.move(under.x + 120, under.y, { steps: 6 });
    await page.mouse.up();
    await expect(page.getByTestId('ruler-total')).toBeVisible();
    await expect(pane).toHaveAttribute('data-collapsed', 'true');

    // Putting Measure away reopens the pane it tucked away.
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await expect(pane).toHaveAttribute('data-collapsed', 'false');
    await expect(transform.getByRole('region', { name: 'Transform: Goblin' })).toBeVisible();

    // AoE template: arming it collapses the pane again; a click on the same cell places it.
    await page.getByRole('button', { name: 'Measure', exact: true }).click();
    await page.getByRole('radio', { name: 'Circle', exact: true }).check();
    await page.getByRole('button', { name: 'Close Measure panel' }).click();
    await expect(pane).toHaveAttribute('data-collapsed', 'true');
    await page.mouse.click(under.x, under.y);
    const ownAoE = () => (host.state as Snapshot).scenes[sceneId]?.entities[identity.identityId];
    await expect.poll(() => ownAoE()?.aoe?.kind).toBe('sphere');

    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await expect(pane).toHaveAttribute('data-collapsed', 'false');

    // The user can still open the pane while measuring, and its controls take the click.
    await page.getByRole('button', { name: 'Measure', exact: true }).click();
    await page.getByRole('radio', { name: 'Ruler', exact: true }).check();
    await expect(pane).toHaveAttribute('data-collapsed', 'true');
    await pane.getByRole('button', { name: 'Expand left pane' }).click();
    await expect(pane).toHaveAttribute('data-collapsed', 'false');
    await transform.getByLabel('X (ft)').click();
    await expect(transform.getByLabel('X (ft)')).toBeFocused();
    expect(errors).toEqual([]);
  } finally {
    await host.close();
    await context.close();
  }
});
