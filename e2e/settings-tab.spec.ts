import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { RawClient, startTable, testUlid, claimSeat } from './harness.js';

test('viewer settings persist locally, DM permissions work, and export downloads a ZIP', async ({
  browser,
}) => {
  const table = await startTable();
  const dmContext = await browser.newContext();
  const dm = await dmContext.newPage();
  const playerContext = await browser.newContext();
  const player = await playerContext.newPage();
  let setup: RawClient | undefined;
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
    setup = await RawClient.connect(table, { name: 'settings-setup', ...identity });
    await setup.waitFor('snapshot', () => setup?.state !== undefined);
    const state = setup.state as { id: string; activeSceneId: string };
    const sceneId = state.activeSceneId;
    const seatId = testUlid('SEAT', 216);
    const tokenId = testUlid('TOKEN', 216);
    expect(await setup.intent('seat.create', { seatId, label: 'Settings player' })).toMatchObject({
      t: 'ack',
    });
    expect(
      await setup.intent('entity.create', {
        sceneId,
        entity: {
          id: tokenId,
          name: 'Delete preference token',
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
    await player.goto(table.clientUrl);
    await claimSeat(player, 'Settings player', 'Settings player');
    await expect(player.getByRole('dialog')).toHaveCount(0);
    for (const page of [dm, player]) {
      await page.getByRole('tab', { name: 'Settings', exact: true }).click();
      await expect(page.getByLabel('Show height labels', { exact: true })).toBeChecked();
      await expect(page.getByLabel('Confirm before deleting', { exact: true })).toBeChecked();
      await expect(
        page.getByRole('button', { name: 'Game log (WIP)', exact: true }),
      ).toBeDisabled();
    }
    await expect(player.getByRole('group', { name: 'Table settings', exact: true })).toHaveCount(0);
    await expect(player.getByLabel('Players may measure')).toHaveCount(0);
    await expect(player.getByLabel('Players may create')).toHaveCount(0);
    await expect(player.getByRole('button', { name: 'Export campaign', exact: true })).toHaveCount(
      0,
    );
    // UI-SET-01 (UX-46, MV-251): no table-wide player toggles remain; they live per seat.
    for (const label of [/players may/i, 'Players may measure', 'Players may create'])
      await expect(dm.getByLabel(label)).toHaveCount(0);
    await expect(
      dm.getByText('Player permissions are set per seat in the Seats tab.', { exact: true }),
    ).toBeVisible();
    await dm.getByLabel('Show height labels', { exact: true }).uncheck();
    await dm.getByLabel('Confirm before deleting', { exact: true }).uncheck();
    await dm.getByRole('radio', { name: 'Light', exact: true }).check();
    await expect(player.getByLabel('Show height labels', { exact: true })).toBeChecked();
    await expect(player.getByLabel('Confirm before deleting', { exact: true })).toBeChecked();
    const downloadPromise = dm.waitForEvent('download');
    await dm.getByRole('button', { name: 'Export campaign', exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`campaign-${state.id}.zip`);
    const path = await download.path();
    if (!path) throw new Error('campaign download missing');
    expect((await readFile(path)).subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    await dm.reload();
    await expect(dm.getByRole('status')).toHaveText('Connected to New campaign');
    await dm.getByRole('tab', { name: 'Settings', exact: true }).click();
    await expect(dm.getByLabel('Show height labels', { exact: true })).not.toBeChecked();
    await expect(dm.getByLabel('Confirm before deleting', { exact: true })).not.toBeChecked();
    await expect(dm.locator('main')).toHaveAttribute('data-theme', 'light');
    await dm.getByRole('tab', { name: 'Entities', exact: true }).click();
    await dm.getByRole('button', { name: 'Delete preference token', exact: true }).click();
    await dm.getByRole('button', { name: 'Delete Delete preference token', exact: true }).click();
    await expect(
      dm.getByRole('button', { name: 'Confirm delete Delete preference token', exact: true }),
    ).toHaveCount(0);
    await expect
      .poll(
        () =>
          (setup?.state as { scenes?: Record<string, { entities?: Record<string, unknown> }> })
            .scenes?.[sceneId]?.entities?.[tokenId],
      )
      .toBeUndefined();
  } finally {
    await setup?.close();
    await dmContext.close();
    await playerContext.close();
    await table.stop();
  }
});
