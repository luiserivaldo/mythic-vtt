import { expect, test } from '@playwright/test';
import { RawClient, seedProfile, startTable, testUlid } from './harness.js';

// UI-TOP-06: the DM's top bar carries one avatar per occupied seat; players get no roster at all.
test('the top bar shows one seat avatar per occupied seat, with a state in words and the latency', async ({
  browser,
}) => {
  const table = await startTable();
  const dmContext = await browser.newContext();
  const watcherContext = await browser.newContext();
  const raw: RawClient[] = [];
  try {
    const dm = await dmContext.newPage();
    await dm.goto(`${table.clientUrl}/#host=${table.hostToken}`);
    await expect(dm.getByRole('status')).toHaveText('Connected to New campaign');
    const identity = await dm.evaluate(
      () =>
        JSON.parse(localStorage.getItem('mythic.identity.v1') ?? '{}') as {
          identityId: string;
          identitySecret: string;
        },
    );
    const setup = await RawClient.connect(table, { name: 'seat-setup', ...identity });
    raw.push(setup);
    await setup.waitFor('snapshot', () => setup.state !== undefined);

    const roster = dm.getByRole('list', { name: 'Participants at the table' });
    const seatId = testUlid('SEAT', 21);
    expect(await setup.intent('seat.create', { seatId, label: 'Ana seat' })).toMatchObject({
      t: 'ack',
    });
    // An empty seat has no avatar: the roster follows occupancy, not the seat list.
    await expect(roster).toHaveCount(0);

    const player = await RawClient.connect(table, {
      name: 'Ana',
      identityId: testUlid('IDENT', 21),
      identitySecret: 'seat-avatar-secret',
    });
    raw.push(player);
    await player.waitFor('snapshot', () => player.state !== undefined);
    player.join(seatId);

    await expect(roster).toBeVisible();
    const avatar = roster.getByRole('listitem');
    await expect(avatar).toHaveCount(1);
    // Colour is never the only signal: the dot says its state, and the offline dot's words differ.
    const dot = avatar.locator('.ui-seat-avatar-dot');
    await expect(dot).toHaveAttribute(
      'aria-label',
      /Good connection|Poor connection|Bad connection|Offline|Latency not measured yet/,
    );
    await expect(dot).toHaveAttribute('title', /connection|Offline|Latency/);
    // The host measures the seat's round trip within its one-second publish window.
    await expect(avatar).toHaveAttribute('title', /Ana seat .* Ana .* \d+ ms/);

    // Hover and keyboard focus both reveal the seat's name and its latency.
    const popup = avatar.locator('.ui-seat-avatar-popup');
    await expect(popup).toBeHidden();
    await avatar.hover();
    await expect(popup).toBeVisible();
    await expect(popup).toContainText('Ana seat');
    await expect(popup).toContainText(/\d+ ms/);
    await avatar.focus();
    await expect(popup).toBeVisible();
    await expect(dm.locator('.ui-top-bar')).not.toContainText('Connected');

    // The seat goes offline when its connection drops, and says so without relying on colour.
    await player.close();
    await expect(dot).toHaveAttribute('aria-label', 'Offline');
    await expect(avatar).toHaveAttribute('title', /Offline/);

    // A spectator receives no roster (PERM-03): the slot stays empty for them.
    await seedProfile(watcherContext, 'Watcher');
    const watcher = await watcherContext.newPage();
    await watcher.goto(table.clientUrl);
    await expect(watcher.getByRole('status')).toHaveText('Connected to New campaign');
    await expect(watcher.getByRole('list', { name: 'Participants at the table' })).toHaveCount(0);
  } finally {
    await Promise.all(raw.map((client) => client.close()));
    await dmContext.close();
    await watcherContext.close();
    await table.stop();
  }
});
