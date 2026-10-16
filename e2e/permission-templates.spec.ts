import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { addSeat, claimSeat, RawClient, startTable, testUlid, type Reply } from './harness.js';

// UX-46 (UI-SEAT-02, UI-SET-01, MV-251): permission templates replace the table-wide toggles. A
// new seat starts from its template's tools, the DM overrides one seat in the Seats tab and the
// player's rail follows (disabled with a reason, never hidden: UI-TOOL-07), and a 0.0.1 save with
// scene toggles keeps each seat's effective permissions after it migrates.

interface Tools {
  measure: boolean;
  draw: boolean;
  pins: boolean;
}
interface Campaign {
  id: string;
  seats: Record<string, { label: string; tools?: Tools }>;
  scenes: Record<string, Record<string, unknown>>;
}

const rail = (page: Page, name: string) =>
  page.getByRole('toolbar', { name: 'Board controls' }).getByRole('button', { name, exact: true });
const ok = async (promise: Promise<Reply>) => {
  expect(await promise).toMatchObject({ t: 'ack' });
};

async function connectDm(page: Page, table: { clientUrl: string; hostToken: string }) {
  await page.goto(`${table.clientUrl.replace(/\/$/, '')}/#host=${table.hostToken}`);
  await expect(page.getByRole('status')).toHaveText('Connected to New campaign');
  return page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('mythic.identity.v1') ?? '{}') as {
        identityId: string;
        identitySecret: string;
      },
  );
}

test('a template sets a new seat tools and a per-seat override changes what the player can do', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const table = await startTable();
  const dmContext = await browser.newContext();
  const playerContext = await browser.newContext();
  try {
    const dm = await dmContext.newPage();
    const errors: string[] = [];
    dm.on('pageerror', (error) => errors.push(error.message));
    const identity = await connectDm(dm, table);
    const setup = await RawClient.connect(table, { name: 'templates host', ...identity });
    await setup.waitFor('snapshot', () => setup.state !== undefined);
    const sceneId = testUlid('SCENE', 262);
    await ok(setup.intent('scene.create', { sceneId, name: 'Template scene' }));
    await ok(setup.intent('scene.activate', { sceneId }));

    // UI-SET-01: no table-wide "players may" toggles in Settings, nor in the Scenes tab.
    await dm.getByRole('tab', { name: 'Settings', exact: true }).click();
    await expect(dm.getByLabel(/players may/i)).toHaveCount(0);
    await dm.getByRole('tab', { name: 'Scenes', exact: true }).click();
    await expect(dm.getByRole('group', { name: 'Player permissions' })).toHaveCount(0);
    await expect(dm.getByLabel(/players may/i)).toHaveCount(0);

    // The template dropdown says what a new seat starts with.
    await dm.getByRole('tab', { name: 'Seats', exact: true }).click();
    const form = dm.getByRole('form', { name: 'Add a seat' });
    await form.getByLabel('Seat template').selectOption({ label: 'Spectator' });
    await expect(form.getByLabel('Template defaults')).toContainText(
      'Starts with: no board tools.',
    );
    await form.getByLabel('Seat template').selectOption({ label: 'Player' });
    await expect(form.getByLabel('Template defaults')).toContainText('Starts with: Measure.');

    // Template default: a Player seat starts with Measure on, Draw and Place pins off.
    await addSeat(dm, 'Player', 'Ranger');
    const seat = dm.getByRole('listitem', { name: 'Ranger seat', exact: true });
    await seat.locator('summary').click();
    const settings = seat.getByRole('group', { name: 'Settings for Ranger' });
    const toggle = (name: string) => settings.getByRole('checkbox', { name, exact: true });
    await expect(toggle('Measure')).toBeChecked();
    await expect(toggle('Draw')).not.toBeChecked();
    await expect(toggle('Place pins')).not.toBeChecked();
    const seatId = Object.entries((setup.state as Campaign).seats).find(
      ([, s]) => s.label === 'Ranger',
    )?.[0];
    if (seatId === undefined) throw new Error('Ranger seat not created');
    expect((setup.state as Campaign).seats[seatId]?.tools).toEqual({
      measure: true,
      draw: false,
      pins: false,
    });

    const player = await playerContext.newPage();
    player.on('pageerror', (error) => errors.push(error.message));
    await player.goto(table.clientUrl);
    await claimSeat(player, 'Ranger', 'Robin');
    await expect(player.getByRole('dialog')).toHaveCount(0);
    await expect(rail(player, 'Measure')).not.toHaveAttribute('aria-disabled', 'true');
    await expect(rail(player, 'Draw')).toHaveAttribute('aria-disabled', 'true');
    await expect(rail(player, 'Draw')).toHaveAttribute(
      'title',
      'The DM has turned off Draw for your seat',
    );

    // Per-seat override: Measure off for this seat only. The tool stays on the rail, disabled
    // with its reason.
    await toggle('Measure').click();
    await expect(toggle('Measure')).not.toBeChecked();
    await setup.waitFor(
      'measure off',
      () => (setup.state as Campaign).seats[seatId]?.tools?.measure === false,
    );
    await expect(rail(player, 'Measure')).toBeVisible();
    await expect(rail(player, 'Measure')).toHaveAttribute('aria-disabled', 'true');
    await expect(rail(player, 'Measure')).toHaveAttribute(
      'title',
      'The DM has turned off Measure for your seat',
    );
    // And Draw on: the player can now draw.
    await toggle('Draw').click();
    await expect(toggle('Draw')).toBeChecked();
    await expect(rail(player, 'Draw')).not.toHaveAttribute('aria-disabled', 'true');

    // A Co-DM seat may always use every tool, so its boxes are shown checked and locked.
    await addSeat(dm, 'Co-DM', 'Lieutenant');
    const coDm = dm.getByRole('listitem', { name: 'Lieutenant seat', exact: true });
    await coDm.locator('summary').click();
    const coDmMeasure = coDm
      .getByRole('group', { name: 'Settings for Lieutenant' })
      .getByRole('checkbox', { name: 'Measure', exact: true });
    await expect(coDmMeasure).toBeChecked();
    await expect(coDmMeasure).toBeDisabled();

    expect(errors).toEqual([]);
    await setup.close();
  } finally {
    await dmContext.close();
    await playerContext.close();
    await table.stop();
  }
});

test('a 0.0.1 save with scene toggles migrates with every seat effective permissions unchanged', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const table = await startTable();
  const playerContext = await browser.newContext();
  const clients: RawClient[] = [];
  try {
    const host = await RawClient.connect(table, {
      name: 'host',
      identityId: testUlid('HOST', 262),
      identitySecret: 'test-host',
      hostToken: table.hostToken,
    });
    clients.push(host);
    await host.waitFor('snapshot', () => host.state !== undefined);
    const sceneId = testUlid('SCENE', 263);
    await ok(host.intent('scene.create', { sceneId, name: 'Old scene' }));
    await ok(host.intent('scene.activate', { sceneId }));
    await ok(host.intent('seat.create', { seatId: testUlid('SEAT', 263), label: 'Veteran' }));
    const state = structuredClone(host.state) as Campaign;
    await host.close();
    clients.length = 0;

    // Rewrite the campaign as a 0.0.1 save (format v8): no seat tools, and the 0.0.1 scene
    // toggles that the Settings and Scenes tabs wrote. Sessions are dropped so the host loads
    // these files rather than recovering from a newer snapshot.
    const folder = join(table.dataDir, 'campaigns', state.id);
    const seats = Object.fromEntries(
      Object.entries(state.seats).map(([id, seat]) => {
        const legacy: Record<string, unknown> = { ...seat };
        delete legacy['tools'];
        return [id, legacy];
      }),
    );
    const { scenes, ...campaign } = state;
    await rm(join(folder, 'sessions'), { recursive: true, force: true });
    await rm(join(folder, 'scenes'), { recursive: true, force: true });
    await mkdir(join(folder, 'scenes'), { recursive: true });
    const toggles = { measure: false, draw: true };
    for (const scene of Object.values(scenes))
      await writeFile(
        join(folder, 'scenes', `${String(scene['id'])}.json`),
        JSON.stringify({ ...scene, playerToggles: toggles, schemaVersion: 8 }),
      );
    await writeFile(
      join(folder, 'campaign.json'),
      JSON.stringify({ ...campaign, seats, schemaVersion: 8 }),
    );
    await table.restart('SIGKILL');

    const after = await RawClient.connect(table, {
      name: 'host after',
      identityId: testUlid('HOST', 262),
      identitySecret: 'test-host',
      hostToken: table.hostToken,
    });
    clients.push(after);
    await after.waitFor('snapshot', () => after.state !== undefined);
    const migrated = after.state as Campaign;
    // 0.0.1: measure off and draw on in every scene, pins at its default (off).
    const expected: Tools = { measure: false, draw: true, pins: false };
    for (const seat of Object.values(migrated.seats)) expect(seat.tools).toEqual(expected);
    expect(JSON.stringify(migrated)).not.toContain('playerToggles');

    // The player's rail shows exactly what 0.0.1 allowed them.
    const player = await playerContext.newPage();
    await player.goto(table.clientUrl);
    await claimSeat(player, 'Veteran', 'Old timer');
    await expect(player.getByRole('dialog')).toHaveCount(0);
    await expect(rail(player, 'Measure')).toHaveAttribute('aria-disabled', 'true');
    await expect(rail(player, 'Measure')).toHaveAttribute(
      'title',
      'The DM has turned off Measure for your seat',
    );
    await expect(rail(player, 'Draw')).not.toHaveAttribute('aria-disabled', 'true');
  } finally {
    await Promise.all(clients.map((client) => client.close()));
    await playerContext.close();
    await table.stop();
  }
});
