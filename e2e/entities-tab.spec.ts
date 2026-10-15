import { expect, test, type Page } from '@playwright/test';
import { RawClient, startTable, testUlid } from './harness.js';

// UX-25 (UI-ENT-01..03): the Entities tab is for mass control. Bulk changes go through the
// action pipeline one entity at a time, a bulk move to the DM layer reaches no player (PERM-03),
// rows centre the view and open the token menu, and delete confirms unless the viewer opted out.

interface SceneState {
  scenes?: Record<string, { entities?: Record<string, { layer: string; name: string }> }>;
}

const entity = (id: string, name: string, x: number, z: number) => ({
  id,
  name,
  layer: 'tokens',
  owners: [],
  transform: {
    position: { x, y: 0, z },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  },
  token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
});

async function view2d(page: Page): Promise<{ centerX: number; centerZ: number }> {
  return page.evaluate(() => {
    const focus = (
      globalThis as unknown as {
        __mythicFocus?: { getView2d(): { centerX: number; centerZ: number } };
      }
    ).__mythicFocus;
    if (!focus) throw new Error('2D camera diagnostics are not mounted');
    return focus.getView2d();
  });
}

test('the DM selects, re-layers, centres on and deletes entities from the Entities tab', async ({
  browser,
}) => {
  const table = await startTable();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const dm = await context.newPage();
  const errors: string[] = [];
  dm.on('pageerror', (e) => errors.push(e.message));
  let setup: RawClient | undefined;
  let player: RawClient | undefined;
  try {
    await dm.goto(`${table.clientUrl}/#host=${table.hostToken}`);
    await expect(dm.getByRole('status')).toHaveText('Connected to New campaign');
    const identity = await dm.evaluate(
      () =>
        JSON.parse(localStorage.getItem('mythic.identity.v1') ?? '{}') as {
          identityId: string;
          identitySecret: string;
        },
    );
    setup = await RawClient.connect(table, { name: 'ux25-setup', ...identity });
    await setup.waitFor('snapshot', () => setup?.state !== undefined);
    const sceneId = (setup.state as { activeSceneId: string }).activeSceneId;
    const seatId = testUlid('SEAT', 250);
    const [ann, bo, cy] = [testUlid('ANN', 251), testUlid('BO', 252), testUlid('CY', 253)];
    expect(await setup.intent('seat.create', { seatId, label: 'Rogue' })).toMatchObject({
      t: 'ack',
    });
    for (const [id, name, x, z] of [
      [ann, 'Ann the scout', 8, 6],
      [bo, 'Bo the hidden', 28, 20],
      [cy, 'Cy the decoy', 14, 22],
    ] as const)
      expect(
        await setup.intent('entity.create', { sceneId, entity: entity(id, name, x, z) }),
      ).toMatchObject({ t: 'ack' });

    const seen = (c: RawClient | undefined, id: string) =>
      (c?.state as SceneState | undefined)?.scenes?.[sceneId]?.entities?.[id];
    player = await RawClient.connect(table, {
      name: 'ux25-player',
      identityId: testUlid('PLAYER', 254),
      identitySecret: 'ux25-player-secret',
    });
    await player.waitFor('snapshot', () => player?.state !== undefined);
    player.join(seatId);
    await player.waitFor('sees the tokens', () => seen(player, bo) !== undefined);

    await dm.getByRole('tab', { name: 'Entities', exact: true }).click();
    const list = dm.getByRole('list', { name: 'Entities in this scene' });
    const bulk = dm.getByRole('toolbar', { name: 'Selected entities' });
    await expect(list.getByRole('listitem')).toHaveCount(3);
    await expect(bulk.getByRole('button', { name: /^Lock/ })).toBeDisabled();
    await expect(bulk.getByRole('button', { name: 'Delete selected' })).toBeDisabled();

    // Select all, then a bulk move onto the DM layer: one entity.setLayer each.
    await bulk.getByLabel('Select all').check();
    await expect(bulk.getByText('3 selected')).toBeVisible();
    await list.getByLabel('Select Ann the scout').uncheck();
    await expect(bulk.getByText('2 selected')).toBeVisible();
    await expect(bulk.getByLabel('Select all')).toHaveJSProperty('indeterminate', true);
    const framesBefore = player.frames.length;
    await bulk.getByLabel('Move selected to layer').selectOption('dm');
    await expect.poll(() => seen(setup, bo)?.layer).toBe('dm');
    await expect.poll(() => seen(setup, cy)?.layer).toBe('dm');
    expect(seen(setup, ann)?.layer).toBe('tokens');
    // PERM-03: the player's state loses both, and no later frame carries their names.
    await player.waitFor('hidden', () => !seen(player, bo) && !seen(player, cy));
    expect(seen(player, ann)).toBeDefined();
    const leaked = player.frames
      .slice(framesBefore)
      .filter((f) => f.includes('Bo the hidden') || f.includes('Cy the decoy'));
    expect(leaked).toEqual([]);

    // UI-ENT-02: the centre button and a double-click centre the 2D view on the entity.
    await list.getByRole('button', { name: 'Centre view on Bo the hidden' }).click();
    await expect.poll(() => view2d(dm)).toMatchObject({ centerX: 28, centerZ: 20 });
    await list.getByRole('button', { name: 'Ann the scout', exact: true }).dblclick();
    await expect.poll(() => view2d(dm)).toMatchObject({ centerX: 8, centerZ: 6 });

    // The three-dot opens that token's full menu (UI-TOKEN-02).
    await list.getByRole('button', { name: 'Open menu for Cy the decoy' }).click();
    await expect(dm.getByTestId('token-menu')).toBeVisible();
    await expect(list.getByLabel('Select Cy the decoy')).toBeChecked();
    await expect(bulk.getByText('1 selected')).toBeVisible();

    // UI-ENT-03: bulk delete confirms; Keep cancels, Confirm deletes each one.
    await bulk.getByLabel('Select all').check();
    await bulk.getByRole('button', { name: 'Delete selected' }).click();
    const confirm = dm.getByRole('alertdialog', { name: 'Delete 3 entities?' });
    await expect(confirm.getByRole('button', { name: 'Keep' })).toBeFocused();
    await confirm.getByRole('button', { name: 'Keep' }).click();
    await expect(confirm).toHaveCount(0);
    await list.getByLabel('Select Ann the scout').uncheck();
    await bulk.getByRole('button', { name: 'Delete selected' }).click();
    await dm.getByRole('button', { name: 'Confirm delete 2 entities' }).click();
    await expect.poll(() => seen(setup, bo)).toBeUndefined();
    await expect.poll(() => seen(setup, cy)).toBeUndefined();
    await expect(list.getByRole('listitem')).toHaveCount(1);

    // With "Confirm before deleting" off, the trash icon deletes at once.
    await dm.getByRole('tab', { name: 'Settings', exact: true }).click();
    await dm.getByLabel('Confirm before deleting', { exact: true }).uncheck();
    await dm.getByRole('tab', { name: 'Entities', exact: true }).click();
    await list.getByRole('button', { name: 'Delete Ann the scout' }).click();
    await expect(dm.getByRole('alertdialog')).toHaveCount(0);
    await expect.poll(() => seen(setup, ann)).toBeUndefined();
    await expect(dm.getByText('Nothing here yet.')).toBeVisible();

    // Add Token goes on the active layer chosen in the Layers tab.
    await dm.getByRole('tab', { name: 'Layers', exact: true }).click();
    await dm.getByRole('button', { name: /^Props/ }).click();
    await dm.getByRole('tab', { name: 'Entities', exact: true }).click();
    const tokenForm = dm.getByRole('form', { name: 'Create token' });
    await expect(tokenForm.getByLabel('Layer')).toHaveValue('props');
    await tokenForm.getByLabel('Token name').fill('Crate guard');
    await tokenForm.getByLabel('Token name').press('Enter');
    await expect(list.getByRole('listitem').filter({ hasText: 'Crate guard' })).toContainText(
      'Props',
    );

    expect(errors).toEqual([]);
  } finally {
    await setup?.close();
    await player?.close();
    await context.close();
    await table.stop();
  }
});
