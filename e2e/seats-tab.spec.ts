import { expect, test, type Page } from '@playwright/test';
import { addSeat, claimSeat, RawClient, startTable, testUlid } from './harness.js';

// UX-28 (UI-SEAT-01..05): the DM-only Seats tab. The DM adds a seat from the template dropdown,
// opens that seat's own settings, and a toggle there changes what the seated player may do. The
// seat's invite link copies, and Archive warns with the affected items before it happens.

interface Campaign {
  seats: Record<string, { label: string; archived?: boolean; permissions: { edit: boolean } }>;
  scenes: Record<string, { entities: Record<string, { owners: string[] }> }>;
}

const rail = (page: Page, name: string) =>
  page.getByRole('toolbar', { name: 'Board controls' }).getByRole('button', { name, exact: true });

test('the DM manages a seat from the Seats tab and the player sees the effect', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const table = await startTable({ publicUrl: 'https://table.example/play' });
  const dmContext = await browser.newContext();
  const playerContext = await browser.newContext();
  try {
    await dmContext.grantPermissions(['clipboard-read', 'clipboard-write']);
    const dm = await dmContext.newPage();
    const errors: string[] = [];
    dm.on('pageerror', (error) => errors.push(error.message));
    await dm.goto(`${table.clientUrl.replace(/\/$/, '')}/#host=${table.hostToken}`);
    await expect(dm.getByRole('status')).toHaveText('Connected to New campaign');
    const identity = await dm.evaluate(
      () =>
        JSON.parse(localStorage.getItem('mythic.identity.v1') ?? '{}') as {
          identityId: string;
          identitySecret: string;
        },
    );
    const setup = await RawClient.connect(table, { name: 'seats host', ...identity });
    await setup.waitFor('snapshot', () => setup.state !== undefined);
    const sceneId = testUlid('SCENE', 228);
    expect((await setup.intent('scene.create', { sceneId, name: 'Seats scene' })).t).toBe('ack');
    expect((await setup.intent('scene.activate', { sceneId })).t).toBe('ack');

    // Add from the template dropdown: the seat lists its name and template, settings collapsed.
    await addSeat(dm, 'Player', 'Ranger');
    const seat = dm.getByRole('listitem', { name: 'Ranger seat', exact: true });
    await expect(seat).toContainText('Player');
    const settings = seat.getByRole('group', { name: 'Settings for Ranger' });
    await expect(settings).toBeHidden();
    await seat.locator('summary').click();
    await expect(settings).toBeVisible();
    const toggle = (name: string) => settings.getByRole('checkbox', { name, exact: true });
    await expect(toggle('Move own tokens')).toBeChecked();
    await expect(toggle('Edit')).not.toBeChecked();
    await expect(toggle('Delete')).not.toBeChecked();
    await expect(toggle('Enable Interaction')).toBeChecked();
    // UI-SEAT-02: no lasting-AoE toggle on a seat.
    await expect(settings.getByRole('checkbox', { name: /aoe/i })).toHaveCount(0);
    const seatId = Object.entries((setup.state as Campaign).seats).find(
      ([, s]) => s.label === 'Ranger',
    )?.[0];
    if (seatId === undefined) throw new Error('Ranger seat not created');

    // The player claims the seat; the template's defaults hold until the DM changes them.
    const player = await playerContext.newPage();
    player.on('pageerror', (error) => errors.push(error.message));
    await player.goto(table.clientUrl);
    await claimSeat(player, 'Ranger', 'Robin');
    await expect(player.getByRole('dialog')).toHaveCount(0);
    await expect(seat).toContainText('Online');
    await expect(rail(player, 'Create Prop')).toHaveAttribute('aria-disabled', 'true');

    // Turning Edit on for this seat lets the player create props.
    // The box is controlled by host state, so it flips on the ack rather than on the click.
    await toggle('Edit').click();
    await expect(toggle('Edit')).toBeChecked();
    await setup.waitFor(
      'edit on',
      () => (setup.state as Campaign).seats[seatId]?.permissions.edit === true,
    );
    await expect(rail(player, 'Create Prop')).not.toHaveAttribute('aria-disabled', 'true');

    // UI-SEAT-05: Enable Interaction off locks every tool for that seat.
    await toggle('Enable Interaction').click();
    await expect(toggle('Enable Interaction')).not.toBeChecked();
    await expect(rail(player, 'Select')).toHaveAttribute('aria-disabled', 'true');
    await expect(rail(player, 'Create Prop')).toHaveAttribute('aria-disabled', 'true');
    await toggle('Enable Interaction').click();
    await expect(toggle('Enable Interaction')).toBeChecked();
    await expect(rail(player, 'Select')).not.toHaveAttribute('aria-disabled', 'true');

    // UI-SEAT-04: copy this seat's invite link.
    const invite = dm.getByRole('listitem', { name: 'Invite link for Ranger', exact: true });
    await invite.getByRole('button', { name: 'Copy link' }).click();
    await expect(dm.getByRole('region', { name: 'Invite links' }).getByRole('status')).toHaveText(
      'Copied the invite link for Ranger.',
    );
    const copied = await dm.evaluate(() =>
      (navigator as unknown as { clipboard: { readText(): Promise<string> } }).clipboard.readText(),
    );
    expect(new URL(copied).hash).toMatch(/^#invite=/);

    // UI-SEAT-03: Archive warns with the login and the tokens it affects, then hands them back.
    const tokenId = testUlid('TOKEN', 228);
    const entity = {
      id: tokenId,
      layer: 'tokens',
      name: 'Ranger hawk',
      owners: [seatId],
      transform: {
        position: { x: 10, y: 0, z: 10 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
      },
      token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
    };
    expect((await setup.intent('entity.create', { sceneId, entity })).t).toBe('ack');
    await settings.getByRole('button', { name: 'Archive seat' }).click();
    const warning = dm.getByRole('dialog', { name: 'Archive Ranger?' });
    await expect(warning).toContainText('Ranger hawk in Seats scene');
    await expect(warning).toContainText('bound login loses access');
    await warning.getByRole('button', { name: 'Confirm archive' }).click();
    await expect(warning).toHaveCount(0);
    await expect(seat).toHaveCount(0);
    await expect(dm.getByText('Ranger (archived)')).toBeAttached();
    await setup.waitFor(
      'archived',
      () => (setup.state as Campaign).seats[seatId]?.archived === true,
    );
    expect((setup.state as Campaign).scenes[sceneId]?.entities[tokenId]?.owners).toEqual([]);

    // The tab is the DM's alone.
    await expect(player.getByRole('tab', { name: 'Seats', exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
    await setup.close();
  } finally {
    await dmContext.close();
    await playerContext.close();
    await table.stop();
  }
});
