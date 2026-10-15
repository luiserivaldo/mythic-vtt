import { expect, test, type Page } from '@playwright/test';
import { openClient, recordPageFrames, startTable } from './harness.js';

// HOST-04: the DM builds and edits scenes with the host running and no players connected, then
// starts the session from that state.

const sceneRow = (page: Page, name: string) => page.getByRole('listitem').filter({ hasText: name });

async function addSeat(page: Page, label: string): Promise<void> {
  await page.getByRole('tab', { name: 'Participants', exact: true }).click();
  await page.getByLabel('Custom participant name').fill(label);
  await page.getByRole('button', { name: 'Add custom participant' }).click();
  await expect(page.getByRole('listitem', { name: `${label} participant` })).toBeVisible();
}

async function createToken(page: Page, name: string): Promise<void> {
  await page.getByRole('tab', { name: 'Entities', exact: true }).click();
  await page.getByLabel('Token name').fill(name);
  await page.getByRole('button', { name: 'Create token' }).click();
  await expect(page.getByTestId('token-label').filter({ hasText: name })).toBeVisible();
}

test('the DM preps scenes with no players connected, then starts the session from that state', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const table = await startTable();
  const dmContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const dm = await dmContext.newPage();
  const errors: string[] = [];
  dm.on('pageerror', (error) => errors.push(error.message));
  // Building a campaign offline must not trip React's unsupported duplicate-key reconciliation.
  dm.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('same key'))
      errors.push(message.text());
  });
  try {
    await dm.goto(`${table.clientUrl}/#host=${table.hostToken}`);
    await expect(dm.getByRole('status')).toHaveText('Connected to New campaign');
    // No players connected: the DM's browser is the only connection on the host.
    expect(await table.connections()).toEqual({ open: 1, authenticated: 1 });

    // Build the scene the session starts on.
    await dm.getByRole('tab', { name: 'Scenes', exact: true }).click();
    await dm.getByLabel('New scene name').fill('Sunken crypt');
    await dm.getByLabel('New scene width').fill('24');
    await dm.getByLabel('New scene height').fill('18');
    await dm.getByRole('button', { name: 'Create scene' }).click();
    await expect(dm.getByLabel('Current scene', { exact: true })).toHaveText('Sunken crypt');

    // A private prep scene: built while it is browsed, never active.
    await dm.getByLabel('DM-only scene').check();
    await dm.getByLabel('New scene name').fill('DM notes');
    await dm.getByRole('button', { name: 'Create scene' }).click();
    await dm.getByLabel('DM-only scene').uncheck();
    await createToken(dm, 'Secret warden');

    // The scene the players join: built while it is browsed, then activated.
    await dm.getByRole('tab', { name: 'Scenes', exact: true }).click();
    await dm.getByLabel('New scene name').fill('Vault of ash');
    await dm.getByRole('button', { name: 'Create scene' }).click();
    await expect(dm.getByLabel('Current scene', { exact: true })).toHaveText('Vault of ash');
    await dm.getByLabel('Canvas of Vault of ash width').fill('30');
    await dm.getByRole('button', { name: 'Save settings' }).click();
    await createToken(dm, 'Warden of ash');
    // The prep edit landed in the browsed scene, not somewhere else.
    await expect(dm.getByRole('heading', { name: 'In Vault of ash' })).toBeVisible();

    // Start the session from the prepared state.
    await dm.getByRole('tab', { name: 'Scenes', exact: true }).click();
    await dm.getByRole('button', { name: 'Options for Vault of ash' }).click();
    await sceneRow(dm, 'Vault of ash')
      .getByRole('button', { name: 'Set active', exact: true })
      .click();
    await expect(sceneRow(dm, 'Vault of ash').getByText('Active')).toBeVisible();
    await addSeat(dm, 'Aria');

    const player = await openClient(browser, table, 'prep-player', { joinScreen: true });
    const frames = recordPageFrames(player.page);
    player.page.on('pageerror', (error) => errors.push(error.message));
    await player.page.getByLabel('Display name').fill('Aria');
    await player.page.getByRole('button', { name: 'Continue', exact: true }).click();
    await player.page.getByRole('radio', { name: /Aria/ }).check();
    await player.page.getByRole('button', { name: 'Join participant slot', exact: true }).click();
    await expect(player.page.getByRole('dialog')).toHaveCount(0);
    await expect(player.page.getByLabel('Current scene', { exact: true })).toHaveText(
      'Vault of ash',
    );
    await expect(player.page.getByTestId('token-label')).toHaveText(['Warden of ash']);
    expect(frames.join('\n')).not.toContain('DM notes');
    expect(frames.join('\n')).not.toContain('Secret warden');
    expect(errors).toEqual([]);
    await player.context.close();
  } finally {
    await dmContext.close();
    await table.stop();
  }
});

test('prep survives a host restart and a player joins the state prepared offline', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const table = await startTable();
  const dmContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const dm = await dmContext.newPage();
  const errors: string[] = [];
  dm.on('pageerror', (error) => errors.push(error.message));
  try {
    await dm.goto(`${table.clientUrl}/#host=${table.hostToken}`);
    await expect(dm.getByRole('status')).toHaveText('Connected to New campaign');
    await dm.getByRole('tab', { name: 'Scenes', exact: true }).click();
    await dm.getByLabel('New scene name').fill('Prepared hall');
    await dm.getByRole('button', { name: 'Create scene' }).click();
    await createToken(dm, 'Stone sentinel');

    // The DM restarts the host between prep sessions; no player has ever connected.
    await table.restart('SIGTERM');
    // The DM's browser reconnects on its own (exponential backoff), still as the host.
    await expect
      .poll(async () => await table.connections(), { timeout: 30_000 })
      .toEqual({ open: 1, authenticated: 1 });
    await expect(dm.getByRole('status')).toHaveText('Connected to New campaign');
    await expect(dm.getByLabel('Current scene', { exact: true })).toHaveText('Prepared hall');
    await expect(dm.getByTestId('token-label').filter({ hasText: 'Stone sentinel' })).toBeVisible();

    await addSeat(dm, 'Borin');
    const player = await openClient(browser, table, 'prep-restart-player', { joinScreen: true });
    player.page.on('pageerror', (error) => errors.push(error.message));
    await player.page.getByLabel('Display name').fill('Borin');
    await player.page.getByRole('button', { name: 'Continue', exact: true }).click();
    await player.page.getByRole('radio', { name: /Borin/ }).check();
    await player.page.getByRole('button', { name: 'Join participant slot', exact: true }).click();
    await expect(player.page.getByRole('dialog')).toHaveCount(0);
    await expect(player.page.getByLabel('Current scene', { exact: true })).toHaveText(
      'Prepared hall',
    );
    await expect(player.page.getByTestId('token-label')).toHaveText(['Stone sentinel']);
    expect(errors).toEqual([]);
    await player.context.close();
  } finally {
    await dmContext.close();
    await table.stop();
  }
});

test('a player waits out the prep, then joins the scene the DM starts the session with', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const table = await startTable();
  const dmContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const dm = await dmContext.newPage();
  const errors: string[] = [];
  dm.on('pageerror', (error) => errors.push(error.message));
  try {
    await dm.goto(`${table.clientUrl}/#host=${table.hostToken}`);
    await expect(dm.getByRole('status')).toHaveText('Connected to New campaign');
    // Prep starts from a campaign with no active scene: the DM deleted the one that was live.
    await dm.getByRole('tab', { name: 'Scenes', exact: true }).click();
    await dm.getByLabel('New scene name').fill('Old map');
    await dm.getByRole('button', { name: 'Create scene' }).click();
    // Deleting a scene is immediate; the last scene cannot be deleted, so the campaign ends up
    // with no active scene while the DM prepares.
    await dm.getByRole('button', { name: 'Options for Old map' }).click();
    await sceneRow(dm, 'Old map').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(sceneRow(dm, 'Old map')).toHaveCount(0);

    // A player with the invite link arrives mid-prep and is held at the join screen.
    const player = await openClient(browser, table, 'prep-waiter', { joinScreen: true });
    const frames = recordPageFrames(player.page);
    player.page.on('pageerror', (error) => errors.push(error.message));
    await player.page.getByLabel('Display name').fill('Aria');
    await player.page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(player.page.getByRole('alert')).toContainText('No active scene');

    // The DM keeps prepping, then starts the session with the prepared scene.
    await dm.getByRole('tab', { name: 'Scenes', exact: true }).click();
    await dm.getByLabel('DM-only scene').check();
    await dm.getByLabel('New scene name').fill('DM notes');
    await dm.getByRole('button', { name: 'Create scene' }).click();
    await dm.getByLabel('DM-only scene').uncheck();
    await createToken(dm, 'Secret warden');
    await dm.getByRole('tab', { name: 'Scenes', exact: true }).click();
    await dm.getByLabel('New scene name').fill('Vault of ash');
    await dm.getByRole('button', { name: 'Create scene' }).click();
    await createToken(dm, 'Warden of ash');
    await addSeat(dm, 'Aria');

    // The waiting player is let in and sees the prepared scene.
    await expect(player.page.getByRole('radio', { name: /Aria/ })).toBeVisible();
    await player.page.getByRole('radio', { name: /Aria/ }).check();
    await player.page.getByRole('button', { name: 'Join participant slot', exact: true }).click();
    await expect(player.page.getByRole('dialog')).toHaveCount(0);
    await expect(player.page.getByLabel('Current scene', { exact: true })).toHaveText(
      'Vault of ash',
    );
    await expect(player.page.getByTestId('token-label')).toHaveText(['Warden of ash']);
    expect(frames.join('\n')).not.toContain('DM notes');
    expect(frames.join('\n')).not.toContain('Secret warden');
    expect(errors).toEqual([]);
    await player.context.close();
  } finally {
    await dmContext.close();
    await table.stop();
  }
});
