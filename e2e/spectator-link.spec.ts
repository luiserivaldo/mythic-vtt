import { expect, test } from '@playwright/test';
import { RawClient, startTable, testUlid, recordPageFrames } from './harness.js';

// Guest connections cannot inherit a host binding, claim seats, or receive DM data (PERM-03).
test('spectator links skip identity/seat selection and remain read-only through updates, reconnects and revocation', async ({
  browser,
}) => {
  const table = await startTable({ publicUrl: 'https://table.example/play' });
  const context = await browser.newContext();
  const guests = await browser.newContext();
  const rawClients: RawClient[] = [];
  try {
    const page = await context.newPage();
    await page.goto(`${table.clientUrl}/#host=${table.hostToken}`);
    await expect(page.getByRole('status')).toHaveText('Connected to New campaign');
    const identity = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('mythic.identity.v1') ?? '{}') as {
          identityId: string;
          identitySecret: string;
        },
    );
    const setup = await RawClient.connect(table, { name: 'DM setup', ...identity });
    rawClients.push(setup);
    await setup.waitFor('snapshot', () => setup.state !== undefined);
    const sceneId = testUlid('SCENE', 1);
    const secretId = testUlid('SECRET', 1);
    const seatId = testUlid('SEAT', 1);
    for (const [type, payload] of [
      ['scene.create', { sceneId, name: 'Watch test' }],
      ['scene.activate', { sceneId }],
      ['seat.create', { seatId, label: 'Player' }],
      [
        'entity.create',
        {
          sceneId,
          entity: {
            id: secretId,
            name: 'SECRET-WATCH',
            layer: 'dm',
            owners: [],
            transform: {
              position: { x: 1, y: 0, z: 1 },
              rotation: { x: 0, y: 0, z: 0, w: 1 },
              scale: { x: 1, y: 1, z: 1 },
            },
          },
        },
      ],
    ] as const)
      expect(await setup.intent(type, payload)).toMatchObject({ t: 'ack' });
    await page.getByRole('button', { name: 'Invite', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Invite players' });
    await panel.getByRole('button', { name: 'Generate new spectator link' }).click();
    await expect(panel.getByRole('status')).toHaveText(
      'New spectator link ready. Previous links revoked.',
    );
    const href = await panel.locator('a[href*="#watch="]').first().getAttribute('href');
    if (!href) throw new Error('spectator link missing');
    const token = new URLSearchParams(new URL(href).hash.slice(1)).get('watch');
    if (!token) throw new Error('token missing');
    const guestPage = await guests.newPage();
    const frames = recordPageFrames(guestPage);
    await guestPage.goto(href.replace(new URL(href).origin, table.clientUrl));
    await expect(guestPage.getByRole('status')).toHaveText('Connected to New campaign');
    await expect(guestPage.getByRole('complementary', { name: 'DM tools' })).toHaveCount(0);
    await expect(guestPage.getByRole('dialog')).toHaveCount(0);
    await expect(guestPage.getByText('Identity backup and transfer', { exact: true })).toHaveCount(
      0,
    );
    expect(await guestPage.evaluate(() => localStorage.getItem('mythic.identity.v1'))).toBeNull();
    const hostWatch = await context.newPage();
    const hostWatchFrames = recordPageFrames(hostWatch);
    await hostWatch.goto(href.replace(new URL(href).origin, table.clientUrl));
    await expect(hostWatch.getByRole('status')).toHaveText('Connected to New campaign');
    await expect(hostWatch.getByRole('complementary', { name: 'DM tools' })).toHaveCount(0);
    expect(await hostWatch.evaluate(() => localStorage.getItem('mythic.host'))).toBe('1');
    // A malicious hello uses the real DM credential; the watch endpoint still forces spectator.
    const watcher = await RawClient.connect(table, {
      name: 'watcher',
      ...identity,
      watchToken: token,
    });
    rawClients.push(watcher);
    await watcher.waitFor('snapshot', () => watcher.state !== undefined);
    expect(await watcher.intent('scene.rename', { sceneId, name: 'Attack' })).toMatchObject({
      t: 'reject',
      reason: 'forbidden',
    });
    expect(
      await watcher.intent('session.join', { seatId, identityId: identity.identityId }),
    ).toMatchObject({ t: 'reject', reason: 'forbidden' });
    watcher.join(seatId);
    await watcher.waitFor('join denied', () =>
      watcher.frames.some((frame) => frame.includes('spectator connections are read-only')),
    );
    expect(
      await setup.intent('entity.update', {
        sceneId,
        entityId: secretId,
        changes: { name: 'SECRET-WATCH-UPDATE' },
      }),
    ).toMatchObject({ t: 'ack' });
    await watcher.waitForSeq(setup.lastSeq);
    await guestPage.reload();
    await expect(guestPage.getByRole('status')).toHaveText('Connected to New campaign');
    for (const frame of [...frames, ...hostWatchFrames, ...watcher.frames]) {
      expect(frame).not.toContain(secretId);
      expect(frame).not.toContain('SECRET-WATCH');
      expect(frame).not.toContain(token);
    }
    await panel.getByRole('button', { name: 'Generate new spectator link' }).click();
    await watcher.waitFor('rotated link disconnected', () => watcher.closed);
    const revoked = await RawClient.connect(table, {
      name: 'revoked',
      ...identity,
      watchToken: token,
    });
    rawClients.push(revoked);
    await revoked.waitFor('revoked link denied', () =>
      revoked.frames.some((frame) => frame.includes('spectator link unavailable')),
    );
    expect(revoked.state).toBeUndefined();
    await expect(panel.locator('a[href*="#watch="]').first()).not.toHaveAttribute('href', href);
    const nextHref = await panel.locator('a[href*="#watch="]').first().getAttribute('href');
    if (!nextHref) throw new Error('regenerated link missing');
    const nextToken = new URLSearchParams(new URL(nextHref).hash.slice(1)).get('watch');
    if (!nextToken) throw new Error('regenerated token missing');
    const replacement = await RawClient.connect(table, {
      name: 'replacement',
      ...identity,
      watchToken: nextToken,
    });
    rawClients.push(replacement);
    await replacement.waitFor('replacement snapshot', () => replacement.state !== undefined);
    await panel.getByRole('button', { name: 'Revoke spectator link' }).click();
    await replacement.waitFor('revoked spectator disconnected', () => replacement.closed);
    await expect(panel.getByRole('status')).toHaveText('Spectator link revoked.');
  } finally {
    await Promise.all(rawClients.map((client) => client.close()));
    await context.close();
    await guests.close();
    await table.stop();
  }
});
