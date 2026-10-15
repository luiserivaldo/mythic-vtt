import { expect, test } from '@playwright/test';
import { RawClient, startTable, testUlid, claimSeat } from './harness.js';

// UX-15 (UI-TOOL-01..07): the left tool rail lists Select, Pan, Measure, Draw, Create Prop and the
// Initiative tracker. A tool a seat may not use stays on the rail, disabled with a reason;
// switching a seat's Enable Interaction off disables every tool.
// LAY-05 (M4-13) adds Draw, the slot UI-TOOL-06 reserved for a later milestone: the rail takes it
// as one registry entry, and the never-hide rule holds for it exactly as for the alpha tools.

const TOOLS = ['Select', 'Pan', 'Measure', 'Draw', 'Create Prop', 'Initiative'];

test('the rail disables, never hides, tools a seat cannot use', async ({ browser }) => {
  test.setTimeout(120_000);
  const table = await startTable();
  const dmContext = await browser.newContext();
  const playerContext = await browser.newContext();
  try {
    const dm = await dmContext.newPage();
    const errors: string[] = [];
    dm.on('pageerror', (error) => errors.push(error.message));
    await dm.goto(`${table.clientUrl}/#host=${table.hostToken}`);
    await expect(dm.getByRole('status')).toHaveText('Connected to New campaign');
    const identity = await dm.evaluate(
      () =>
        JSON.parse(localStorage.getItem('mythic.identity.v1') ?? '{}') as {
          identityId: string;
          identitySecret: string;
        },
    );
    const setup = await RawClient.connect(table, { name: 'rail host', ...identity });
    await setup.waitFor('snapshot', () => setup.state !== undefined);
    const sceneId = testUlid('SCENE', 81);
    const seatId = testUlid('SEAT', 81);
    expect((await setup.intent('scene.create', { sceneId, name: 'Rail scene' })).t).toBe('ack');
    expect((await setup.intent('scene.activate', { sceneId })).t).toBe('ack');
    expect((await setup.intent('seat.create', { seatId, label: 'Rail seat' })).t).toBe('ack');

    const rail = (page: typeof dm, name: string) =>
      page
        .getByRole('toolbar', { name: 'Board controls' })
        .getByRole('button', { name, exact: true });

    // The DM gets all five tools, enabled, with Select active; dividers separate the groups.
    for (const name of TOOLS) await expect(rail(dm, name)).toBeVisible();
    for (const name of TOOLS)
      await expect(rail(dm, name)).not.toHaveAttribute('aria-disabled', 'true');
    await expect(rail(dm, 'Select')).toHaveAttribute('aria-pressed', 'true');
    expect(await dm.locator('.ui-board-controls .ui-rail-divider').count()).toBeGreaterThanOrEqual(
      3,
    );
    // Pin, Lighting and Fog are still unimplemented (UI-TOOL-06), so they are not on the rail at all.
    for (const absent of ['Pin', 'Lighting', 'Fog']) await expect(rail(dm, absent)).toHaveCount(0);

    // Initiative opens the real tracker in the left pane (UX-38).
    await expect(rail(dm, 'Initiative')).not.toContainText('WIP');
    await rail(dm, 'Initiative').click();
    await expect(dm.getByRole('region', { name: 'Rounds and initiative' })).toContainText(
      'Round 1',
    );

    // Pan is its own active tool; Measure arms the ruler and takes the rail over.
    await rail(dm, 'Pan').click();
    await expect(rail(dm, 'Pan')).toHaveAttribute('aria-pressed', 'true');
    await rail(dm, 'Measure').click();
    await expect(rail(dm, 'Measure')).toHaveAttribute('aria-pressed', 'true');
    await expect(rail(dm, 'Pan')).toHaveAttribute('aria-pressed', 'false');
    await rail(dm, 'Select').click();
    await expect(rail(dm, 'Measure')).toHaveAttribute('aria-pressed', 'false');

    // Create Prop opens the prop form and places the prop.
    await rail(dm, 'Create Prop').click();
    const form = dm.getByRole('form', { name: 'Create prop' });
    await expect(form).toBeVisible();
    await form.getByLabel('Prop name').fill('Rail crate');
    await form.getByRole('button', { name: 'Create prop' }).click();
    await expect
      .poll(() => JSON.stringify(setup.state).includes('Rail crate'), { timeout: 10_000 })
      .toBe(true);

    // A player without edit rights: Create Prop stays, disabled with its reason.
    const player = await playerContext.newPage();
    await player.goto(table.clientUrl);
    await claimSeat(player, 'Rail seat', 'Rail Guest');
    await expect(player.getByRole('dialog')).toHaveCount(0);
    for (const name of TOOLS) await expect(rail(player, name)).toBeVisible();
    await expect(rail(player, 'Create Prop')).toHaveAttribute('aria-disabled', 'true');
    await expect(rail(player, 'Create Prop')).toHaveAttribute(
      'title',
      'Your seat cannot create props',
    );
    await expect(rail(player, 'Select')).not.toHaveAttribute('aria-disabled', 'true');
    await expect(rail(player, 'Measure')).not.toHaveAttribute('aria-disabled', 'true');
    // Playwright waits on aria-disabled targets; force the click to prove it does nothing.
    await rail(player, 'Create Prop').click({ force: true });
    await expect(player.getByRole('form', { name: 'Create prop' })).toHaveCount(0);

    // LAY-05 (M4-13): Draw stays on the rail too, and opens no panel the seat may not use.
    await expect(rail(player, 'Draw')).toHaveAttribute('aria-disabled', 'true');
    await expect(rail(player, 'Draw')).toHaveAttribute(
      'title',
      'Drawing is disabled in this scene',
    );
    await rail(player, 'Draw').click({ force: true });
    await expect(player.getByRole('region', { name: 'Draw tool' })).toHaveCount(0);

    // PERM-05: the DM opens the scene's Draw toggle, and the player's tool becomes usable.
    expect(
      (await setup.intent('scene.setPlayerToggles', { sceneId, toggles: { draw: true } })).t,
    ).toBe('ack');
    await expect(rail(player, 'Draw')).not.toHaveAttribute('aria-disabled', 'true');
    await rail(player, 'Draw').click();
    await expect(rail(player, 'Draw')).toHaveAttribute('aria-pressed', 'true');
    await expect(player.getByRole('region', { name: 'Draw tool' })).toBeVisible();
    await rail(player, 'Select').click();
    await expect(player.getByRole('region', { name: 'Draw tool' })).toHaveCount(0);

    // Enable Interaction off: every tool is disabled with the same reason, none hidden.
    expect((await setup.intent('seat.update', { seatId, interactionEnabled: false })).t).toBe(
      'ack',
    );
    for (const name of TOOLS) {
      await expect(rail(player, name)).toHaveAttribute('aria-disabled', 'true');
      await expect(rail(player, name)).toHaveAttribute(
        'title',
        'Interaction is turned off for your seat',
      );
    }
    expect((await setup.intent('seat.update', { seatId, interactionEnabled: true })).t).toBe('ack');
    await expect(rail(player, 'Select')).not.toHaveAttribute('aria-disabled', 'true');
    // The scene toggle is still on, so Draw comes back with the rest.
    await expect(rail(player, 'Draw')).not.toHaveAttribute('aria-disabled', 'true');

    // A spectator may open the same tracker, and it opens only when the entry is used — a
    // read-only viewer still gets no editing panels of their own.
    const spectatorContext = await browser.newContext();
    try {
      const spectator = await spectatorContext.newPage();
      await spectator.goto(table.clientUrl);
      await spectator.getByRole('button', { name: 'Join As Spectator' }).click();
      await expect(spectator.getByRole('dialog')).toHaveCount(0);
      await expect(spectator.getByRole('region', { name: 'Rounds and initiative' })).toHaveCount(0);
      const watcherRail = rail(spectator, 'Initiative');
      await expect(watcherRail).not.toHaveAttribute('aria-disabled', 'true');
      await watcherRail.click();
      await expect(spectator.getByRole('region', { name: 'Rounds and initiative' })).toContainText(
        'Round 1',
      );
    } finally {
      await spectatorContext.close();
    }

    expect(errors).toEqual([]);
    await setup.close();
  } finally {
    await dmContext.close();
    await playerContext.close();
    await table.stop();
  }
});
