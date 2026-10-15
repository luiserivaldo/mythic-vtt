import { expect, test, type Page } from '@playwright/test';
import { Campaign } from '../packages/shared/src/index.js';
import { RawClient, openClient, recordPageFrames, startTable, testUlid } from './harness.js';

// UI-SCN-01 (MV-247): the DM's Scenes view expands from the top bar as cards grouped in folders.
// Setting a scene active moves the party; folders and DM-only scenes never reach a player.

const card = (page: Page, name: string) => page.getByRole('listitem').filter({ hasText: name });

async function createScene(
  dm: Page,
  name: string,
  folder: string,
  size?: { width: string; height: string },
): Promise<void> {
  await dm.getByLabel('New scene name').fill(name);
  await dm.getByLabel('New scene folder').fill(folder);
  if (size) {
    await dm.getByLabel('New scene width').fill(size.width);
    await dm.getByLabel('New scene height').fill(size.height);
  }
  await dm.getByRole('button', { name: 'Create scene' }).click();
  await expect(dm.getByRole('button', { name: `View ${name}`, exact: true })).toBeVisible();
}

test('the DM creates scenes in folders, sizes the canvas and sets the active scene', async ({
  browser,
}) => {
  const table = await startTable();
  const dmContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const dm = await dmContext.newPage();
  const clients: RawClient[] = [];
  const errors: string[] = [];
  dm.on('pageerror', (error) => errors.push(error.message));
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
    const host = await RawClient.connect(table, { name: 'DM', ...identity });
    clients.push(host);
    await host.waitFor('snapshot', () => host.state !== undefined);
    const seatId = testUlid('SEAT', 120);
    expect(await host.intent('seat.create', { seatId, label: 'Player' })).toMatchObject({
      t: 'ack',
    });

    const player = await openClient(browser, table, 'scenes-view-player', { joinScreen: true });
    const frames = recordPageFrames(player.page);
    player.page.on('pageerror', (error) => errors.push(error.message));
    await player.page.getByLabel('Display name').fill('Aria');
    await player.page.getByRole('button', { name: 'Continue', exact: true }).click();
    await player.page.getByRole('radio', { name: /Player/ }).check();
    await player.page.getByRole('button', { name: 'Join participant slot', exact: true }).click();
    await expect(player.page.getByRole('dialog')).toHaveCount(0);
    await expect(player.page.getByLabel('Scene name', { exact: true })).toHaveText('Blank scene');

    // The view expands from the scene header; scene filters and the Browse list are gone.
    await dm.getByRole('button', { name: 'Scene picker', exact: true }).click();
    await expect(dm.getByRole('heading', { name: 'Scenes', exact: true })).toBeVisible();
    await expect(dm.getByRole('region', { name: 'Scene cards', exact: true })).toBeVisible();
    await expect(dm.getByLabel('Tint', { exact: true })).toHaveCount(0);
    await expect(dm.getByLabel('Darkness', { exact: true })).toHaveCount(0);
    await expect(dm.getByRole('button', { name: 'Browse' })).toHaveCount(0);
    await expect(dm.getByText('Skybox image')).toHaveCount(0);

    // Settings from the card's quick menu: rename the starting scene.
    await dm.getByRole('button', { name: 'Options for Blank scene' }).click();
    await card(dm, 'Blank scene').getByRole('button', { name: 'Settings', exact: true }).click();
    const blankSettings = dm.getByRole('form', { name: 'Settings for Blank scene' });
    await blankSettings.getByLabel('Name', { exact: true }).fill('Lobby');
    await blankSettings.getByRole('button', { name: 'Save settings' }).click();
    await expect(dm.getByRole('button', { name: 'View Lobby', exact: true })).toBeVisible();
    await expect(player.page.getByLabel('Scene name', { exact: true })).toHaveText('Lobby');
    await dm.getByRole('button', { name: 'Close settings' }).click();

    // Create: a sized scene in a folder, a second folder, and a DM-only prep scene.
    await createScene(dm, 'Crypt', 'Act 1', { width: '24', height: '18' });
    await createScene(dm, 'Tavern', 'Act 2');
    await dm.getByLabel('DM-only scene').check();
    await createScene(dm, 'SECRET-PREP', 'SECRET-FOLDER');
    await dm.getByLabel('DM-only scene').uncheck();

    // Folder grouping.
    const act1 = dm.getByRole('region', { name: 'Folder Act 1' });
    await expect(act1.getByRole('listitem')).toHaveText([/Crypt/]);
    await expect(dm.getByRole('region', { name: 'Folder Act 2' }).getByRole('listitem')).toHaveText(
      [/Tavern/],
    );
    await expect(
      dm.getByRole('region', { name: 'Scenes without a folder' }).getByRole('listitem'),
    ).toHaveText([/Lobby/]);
    await expect(
      dm
        .getByRole('region', { name: 'Folder SECRET-FOLDER' })
        .getByText('DM-only', { exact: true }),
    ).toBeVisible();

    // Canvas Size in cells with the pixel size beside it, and Cell Size.
    await dm.getByRole('button', { name: 'Options for Crypt' }).click();
    await card(dm, 'Crypt').getByRole('button', { name: 'Settings', exact: true }).click();
    const crypt = dm.getByRole('form', { name: 'Settings for Crypt' });
    await expect(crypt.getByRole('group', { name: 'Canvas Size' })).toBeVisible();
    await expect(crypt.getByLabel('Canvas of Crypt width')).toHaveValue('24');
    await expect(crypt.getByLabel('Canvas of Crypt height')).toHaveValue('18');
    const pixels = crypt.getByLabel('Canvas of Crypt in pixels');
    await expect(pixels).toHaveText('1680 px × 1260 px');
    await crypt.getByLabel('Cell Size (px)').fill('100');
    await crypt.getByLabel('Canvas of Crypt width').fill('30');
    await expect(pixels).toHaveText('3000 px × 1800 px');
    await crypt.getByLabel('Canvas of Crypt width').fill('201');
    await expect(crypt.getByRole('button', { name: 'Save settings' })).toBeDisabled();
    await crypt.getByLabel('Canvas of Crypt width').fill('30');
    await crypt.getByRole('button', { name: 'Save settings' }).click();
    await host.waitFor('crypt resized', () => {
      const scene = Object.values(Campaign.parse(host.state).scenes).find(
        (s) => s.name === 'Crypt',
      );
      return scene?.bounds?.width === 30 && scene.grid.sizePx === 100;
    });
    await expect(dm.getByRole('form', { name: 'Settings for Crypt' })).toBeVisible();
    await expect(
      dm.getByRole('form', { name: 'Settings for Crypt' }).getByRole('button', {
        name: 'Save settings',
      }),
    ).toBeDisabled();

    // A DM-only scene cannot be set active (existing behaviour, C18 still open).
    await dm.getByRole('button', { name: 'Options for SECRET-PREP' }).click();
    await expect(
      card(dm, 'SECRET-PREP').getByRole('button', { name: 'Set active', exact: true }),
    ).toBeDisabled();

    // Set active moves the party to the scene; the DM's card shows it.
    await dm.getByRole('button', { name: 'Options for Crypt' }).click();
    await card(dm, 'Crypt').getByRole('button', { name: 'Set active', exact: true }).click();
    await expect(player.page.getByLabel('Scene name', { exact: true })).toHaveText('Crypt');
    await expect(player.page.getByLabel('Current scene', { exact: true })).toHaveText('Crypt');
    await expect(card(dm, 'Crypt').getByText('Active', { exact: true })).toBeVisible();

    // Viewing another scene is local and undoable (F28/F29).
    await dm.getByRole('button', { name: 'View Tavern', exact: true }).click();
    await expect(dm.getByLabel('Current scene', { exact: true })).toHaveText('Tavern');
    await expect(player.page.getByLabel('Current scene', { exact: true })).toHaveText('Crypt');
    await dm.getByRole('button', { name: 'Back to active scene' }).click();
    await expect(dm.getByLabel('Current scene', { exact: true })).toHaveText('Crypt');

    // PERM-03: no DM-only scene and no folder name ever reached the player.
    await player.page.reload();
    await expect(player.page.getByLabel('Scene name', { exact: true })).toHaveText('Crypt');
    const received = frames.join('\n');
    for (const secret of ['SECRET-PREP', 'SECRET-FOLDER', 'Act 1', 'Act 2', '"folder"', 'Tavern']) {
      expect(received).not.toContain(secret);
    }
    expect(errors).toEqual([]);
    await player.context.close();
  } finally {
    await Promise.all(clients.map((client) => client.close()));
    await dmContext.close();
    await table.stop();
  }
});
