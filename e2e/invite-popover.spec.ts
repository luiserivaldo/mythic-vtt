import { expect, test } from '@playwright/test';
import { RawClient, recordPageFrames, startTable, testUlid } from './harness.js';

// UI-TOP-07 / UI-SEAT-04: the DM's top bar invite popover; players and spectators never get it.
test('the DM invites from the top bar popover, and the seated player and a spectator never see it', async ({
  browser,
}) => {
  const table = await startTable({ publicUrl: 'https://table.example/play' });
  const dmContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const watchContext = await browser.newContext();
  const clients: RawClient[] = [];
  try {
    await dmContext.grantPermissions(['clipboard-read', 'clipboard-write']);
    const dm = await dmContext.newPage();
    await dm.goto(`${table.clientUrl.replace(/\/$/, '')}/#host=${table.hostToken}`);
    await expect(dm.getByRole('status')).toHaveText('Connected to New campaign');
    const identity = await dm.evaluate(
      () =>
        JSON.parse(localStorage.getItem('mythic.identity.v1') ?? '{}') as {
          identityId: string;
          identitySecret: string;
        },
    );
    const setup = await RawClient.connect(table, { name: 'invite setup', ...identity });
    clients.push(setup);
    await setup.waitFor('snapshot', () => setup.state !== undefined);
    expect(
      await setup.intent('seat.create', { seatId: testUlid('SEAT', 1), label: 'Aria' }),
    ).toMatchObject({ t: 'ack' });

    const bar = dm.locator('header.ui-top-bar');
    await bar.getByRole('button', { name: 'Invite', exact: true }).click();
    const popover = dm.getByRole('dialog', { name: 'Invite players' });
    await expect(popover).toContainText('https://table.example/play');
    await expect(popover.getByRole('link', { name: /Read the guide/ })).toHaveAttribute(
      'href',
      /docs\/internet-play\.md$/,
    );
    const relay = popover.getByRole('region', { name: 'Mythic Cloud relay' });
    await expect(relay).toContainText('Coming soon');
    await expect(relay.getByRole('button', { name: 'Get a public link' })).toBeDisabled();

    await popover
      .getByRole('listitem', { name: 'Seat Aria' })
      .getByRole('button', { name: 'Copy invite for this seat' })
      .click();
    await expect(popover.getByRole('status')).toHaveText('Copied the invite for Aria.');
    const copied = await dm.evaluate(() =>
      (navigator as unknown as { clipboard: { readText(): Promise<string> } }).clipboard.readText(),
    );
    const hash = new URL(copied).hash;
    expect(hash).toMatch(/^#invite=[0-9A-HJKMNP-TV-Z]{26}\.[A-Za-z0-9_-]{43}$/);
    const token = hash.slice(hash.indexOf('.') + 1);
    // The token reaches the clipboard only; the popover never prints it.
    await expect(popover).not.toContainText(token);
    await dm.keyboard.press('Escape');
    await expect(popover).toBeHidden();

    // The person holding the link takes the seat: no Invite button, no token on the wire.
    const guest = await guestContext.newPage();
    const frames = recordPageFrames(guest);
    await guest.goto(`${table.clientUrl.replace(/\/$/, '')}/${hash}`);
    await expect(guest.getByRole('status')).toHaveText('Connected to New campaign');
    const guestId = await guest.evaluate(
      () =>
        (JSON.parse(localStorage.getItem('mythic.identity.v1') ?? '{}') as { identityId: string })
          .identityId,
    );
    await setup.waitFor('seated', () => JSON.stringify(setup.state).includes(guestId));
    await expect(guest.locator('header.ui-top-bar')).toBeVisible();
    await expect(guest.getByRole('button', { name: 'Invite', exact: true })).toHaveCount(0);
    await expect(guest.getByText('Copy invite for this seat')).toHaveCount(0);
    expect(frames.join('\n')).not.toContain(token);

    // A spectator neither.
    await dm.getByRole('tab', { name: 'Invite', exact: true }).click();
    const share = dm.getByRole('region', { name: 'Invite players' });
    await share.getByRole('button', { name: 'Generate new spectator link' }).click();
    const href = await share.locator('a[href*="#watch="]').first().getAttribute('href');
    if (!href) throw new Error('spectator link missing');
    const watcher = await watchContext.newPage();
    await watcher.goto(href.replace(new URL(href).origin, table.clientUrl.replace(/\/$/, '')));
    await expect(watcher.getByRole('status')).toHaveText('Connected to New campaign');
    await expect(watcher.locator('header.ui-top-bar')).toBeVisible();
    await expect(watcher.getByRole('button', { name: 'Invite', exact: true })).toHaveCount(0);
    await expect(watcher.getByText('Mythic Cloud relay')).toHaveCount(0);
  } finally {
    await Promise.all(clients.map((client) => client.close()));
    await Promise.all([dmContext.close(), guestContext.close(), watchContext.close()]);
    await table.stop();
  }
});
