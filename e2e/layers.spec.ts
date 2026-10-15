import { expect, test } from '@playwright/test';
import { RawClient, startTable, testUlid, claimSeat } from './harness.js';

// UI-LAY-01: the Layers tab lists layers top row first, marks one active layer for the viewer,
// and the DM row never reaches a player.
test('the Layers tab lists draw order, one active layer, and hides the DM row from players', async ({
  browser,
}) => {
  const table = await startTable();
  const dmContext = await browser.newContext();
  const playerContext = await browser.newContext();
  const errors: string[] = [];
  try {
    const dm = await dmContext.newPage();
    dm.on('pageerror', (error) => errors.push(error.message));
    await dm.goto(`${table.clientUrl.replace(/\/$/, '')}/#host=${table.hostToken}`);
    await expect(dm.getByRole('status')).toHaveText('Connected to New campaign');

    // Seed an active scene plus a participant slot the guest will join as a player.
    const identity = await dm.evaluate(
      () =>
        JSON.parse(localStorage.getItem('mythic.identity.v1') ?? '{}') as {
          identityId: string;
          identitySecret: string;
        },
    );
    const sceneId = testUlid('SCENE', 261);
    const seatId = testUlid('SEAT', 261);
    const setup = await RawClient.connect(table, { name: 'layers-setup', ...identity });
    await setup.waitFor('host snapshot', () => setup.state !== undefined);
    expect((await setup.intent('scene.create', { sceneId, name: 'Layer scene' })).t).toBe('ack');
    expect((await setup.intent('scene.activate', { sceneId })).t).toBe('ack');
    expect((await setup.intent('seat.create', { seatId, label: 'Layers guest' })).t).toBe('ack');

    await dm.getByRole('tab', { name: 'Layers', exact: true }).click();
    const layers = dm.getByRole('region', { name: 'Layers' });
    const rows = layers.getByRole('listitem');

    // Rows run top to bottom by draw order: the top row draws above the rows beneath it.
    await expect(rows).toHaveCount(5);
    await expect(rows.nth(0)).toContainText('Effects');
    await expect(rows.nth(1)).toContainText('Tokens');
    await expect(rows.nth(2)).toContainText('Props');
    await expect(rows.nth(3)).toContainText('DM only');
    await expect(rows.nth(4)).toContainText('Map');
    await expect(layers).toContainText('Battlemap images, ground, terrain and fixed objects');

    // The DM sees the DM row, and may lock it and toggle its eye.
    const dmRow = layers.getByRole('button', { name: 'DM only', exact: true });
    await expect(dmRow).toBeVisible();
    await expect(layers.getByRole('checkbox', { name: 'Lock DM only' })).toBeEnabled();
    await expect(layers.getByRole('checkbox', { name: 'Show DM only' })).toBeEnabled();

    // One active layer, starting on Tokens; clicking a row moves the highlight.
    await expect(layers.getByRole('button', { pressed: true })).toHaveText('Tokens');
    const propsRow = layers.getByRole('button', { name: 'Props', exact: true });
    await propsRow.click();
    await expect(propsRow).toHaveAttribute('aria-pressed', 'true');
    await expect(layers.getByRole('button', { pressed: true })).toHaveText('Props');
    await expect(layers.getByRole('button', { name: 'Tokens', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    // The eye is local to this screen: no action, just the local view state.
    const showTokens = layers.getByRole('checkbox', { name: 'Show Tokens' });
    await showTokens.click();
    await expect(showTokens).not.toBeChecked();
    await showTokens.click();
    await expect(showTokens).toBeChecked();

    // The lock goes through the existing layer-lock action (its state arrives with the patch).
    const lockProps = layers.getByRole('checkbox', { name: 'Lock Props' });
    await lockProps.click();
    await expect(lockProps).toBeChecked();

    // Creation defaults to the active layer, for tokens and props alike.
    await dm.getByRole('tab', { name: 'Entities', exact: true }).click();
    await expect(
      dm.getByRole('form', { name: 'Create token' }).getByRole('combobox', { name: /^Layer/ }),
    ).toHaveValue('props');
    await expect(
      dm.getByRole('form', { name: 'Create prop' }).getByRole('combobox', { name: /^Layer/ }),
    ).toHaveValue('props');

    // A player never gets the Layers tab, so the DM row never reaches them.
    const player = await playerContext.newPage();
    player.on('pageerror', (error) => errors.push(error.message));
    await player.goto(table.clientUrl);
    await claimSeat(player, 'Layers guest', 'Layers guest');
    await expect(player.getByRole('status')).toHaveText('Connected to New campaign');
    await expect(player.getByRole('tab', { name: 'Layers', exact: true })).toHaveCount(0);
    for (const name of ['Chat', 'Sheet', 'Help', 'Settings']) {
      await player.getByRole('tab', { name, exact: true }).click();
      await expect(player.getByRole('region', { name: 'Layers' })).toHaveCount(0);
      await expect(player.getByText('DM only', { exact: true })).toHaveCount(0);
    }

    expect(errors).toEqual([]);
    await setup.close();
  } finally {
    await playerContext.close();
    await dmContext.close();
    await table.stop();
  }
});
