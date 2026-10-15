import { expect, test } from '@playwright/test';
import {
  addSeat,
  RawClient,
  recordPageFrames,
  startTable,
  testUlid,
  type Reply,
} from './harness.js';

const ok = async (promise: Promise<Reply>) => {
  expect(await promise).toMatchObject({ t: 'ack' });
};

test('seat invite links seat a stranger, stay private, and revoke or regenerate immediately', async () => {
  const table = await startTable();
  const clients: RawClient[] = [];
  try {
    const base = `http://127.0.0.1:${String(table.hostPort)}`;
    const sceneId = testUlid('SCENE', 1);
    const seatA = testUlid('SEAT', 1);
    const seatB = testUlid('SEAT', 2);
    const hostOpts = {
      name: 'host',
      identityId: testUlid('HOST', 1),
      identitySecret: 'test-host',
      hostToken: table.hostToken,
    };
    const auth = (identityId: string, secret: string) => ({
      authorization: `Mythic ${identityId}.${secret}`,
    });
    const hostHeaders = auth(hostOpts.identityId, hostOpts.identitySecret);
    const host = await RawClient.connect(table, hostOpts);
    clients.push(host);
    await host.waitFor('snapshot', () => host.state !== undefined);
    await ok(host.intent('scene.create', { sceneId, name: 'Invites' }));
    await ok(host.intent('scene.activate', { sceneId }));
    await ok(host.intent('seat.create', { seatId: seatA, label: 'Aria' }));
    await ok(host.intent('seat.create', { seatId: seatB, label: 'Bram' }));
    await ok(
      host.intent('entity.create', {
        sceneId,
        entity: {
          id: testUlid('SECRET', 1),
          name: 'SECRET-INVITE',
          layer: 'dm',
          owners: [],
          transform: {
            position: { x: 1, y: 0, z: 1 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
          },
        },
      }),
    );

    const issue = async (seatId: string) =>
      (
        await fetch(`${base}/api/seat-invites/${seatId}`, { method: 'POST', headers: hostHeaders })
      ).json() as Promise<{ token: string }>;
    const newPlayer = async (n: number) => {
      const opts = {
        name: `player${String(n)}`,
        identityId: testUlid('PLAYER', n),
        identitySecret: `secret-${String(n)}`,
      };
      const client = await RawClient.connect(table, opts);
      clients.push(client);
      await client.waitFor('snapshot', () => client.state !== undefined);
      return { opts, client };
    };
    const redeem = (
      p: { opts: { identityId: string; identitySecret: string } },
      seatId: string,
      token: string,
    ) =>
      fetch(`${base}/api/seat-invites/redeem`, {
        method: 'POST',
        headers: {
          ...auth(p.opts.identityId, p.opts.identitySecret),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ seatId, token }),
      });

    // Only the host can manage invites.
    const stranger = await newPlayer(1);
    expect(
      (
        await fetch(`${base}/api/seat-invites/${seatA}`, {
          method: 'POST',
          headers: auth(stranger.opts.identityId, stranger.opts.identitySecret),
        })
      ).status,
    ).toBe(403);

    // A stranger redeems an invite and is seated with a seat-filtered view.
    const { token } = await issue(seatA);
    expect((await redeem(stranger, seatB, token)).status).toBe(404); // another seat's door
    expect((await redeem(stranger, seatA, token)).status).toBe(200);
    await stranger.client.waitFor('seated', () =>
      JSON.stringify(stranger.client.state).includes(stranger.opts.identityId),
    );
    expect(stranger.client.frames.join('\n')).not.toContain('SECRET-INVITE');
    expect(stranger.client.frames.join('\n')).not.toContain(token);

    // A second person cannot take an occupied seat with the same link.
    const second = await newPlayer(2);
    expect((await redeem(second, seatA, token)).status).toBe(409);

    // Revoking stops the link at once; regenerating kills the old one and arms the new one.
    const bramLink = (await issue(seatB)).token;
    const bramNext = (await issue(seatB)).token;
    expect((await redeem(second, seatB, bramLink)).status).toBe(404);
    expect(
      (await fetch(`${base}/api/seat-invites/${seatB}`, { method: 'DELETE', headers: hostHeaders }))
        .status,
    ).toBe(200);
    expect((await redeem(second, seatB, bramNext)).status).toBe(404);
    const fresh = (await issue(seatB)).token;
    expect((await redeem(second, seatB, fresh)).status).toBe(200);
    await second.client.waitFor('seated', () =>
      JSON.stringify(second.client.state).includes(second.opts.identityId),
    );
    for (const client of [stranger.client, second.client])
      for (const secret of [token, bramLink, bramNext, fresh])
        expect(client.frames.join('\n')).not.toContain(secret);
  } finally {
    await Promise.all(clients.map((client) => client.close()));
    await table.stop();
  }
});

// The DM drives the panel the way the seat panel offers it: copy a link, send it, revoke it.
test('the DM copies a seat invite link, a second browser takes the seat with it, and revoke kills the link', async ({
  browser,
}) => {
  const table = await startTable({ publicUrl: 'https://table.example/play' });
  const dmContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const lateContext = await browser.newContext();
  try {
    await dmContext.grantPermissions(['clipboard-read', 'clipboard-write']);
    const dm = await dmContext.newPage();
    await dm.goto(`${table.clientUrl.replace(/\/$/, '')}/#host=${table.hostToken}`);
    await expect(dm.getByRole('status')).toHaveText('Connected to New campaign');
    await addSeat(dm, 'Player');
    const row = dm.getByRole('listitem', { name: 'Invite link for Player', exact: true });
    await expect(row).toContainText('No link');

    await row.getByRole('button', { name: 'Copy link' }).click();
    const invites = dm.getByRole('region', { name: 'Invite links' });
    await expect(invites.getByRole('status')).toHaveText('Copied the invite link for Player.');
    await expect(row).toContainText('Link active');
    const copied = await dm.evaluate(() =>
      (navigator as unknown as { clipboard: { readText(): Promise<string> } }).clipboard.readText(),
    );
    const hash = new URL(copied).hash;
    expect(hash).toMatch(/^#invite=[0-9A-HJKMNP-TV-Z]{26}\.[A-Za-z0-9_-]{43}$/);
    expect(await row.getByRole('link').getAttribute('href')).toBe(copied);

    // The stranger holding the link takes the seat, and never sees a control or the token.
    const guest = await guestContext.newPage();
    const frames = recordPageFrames(guest);
    await guest.goto(`${table.clientUrl.replace(/\/$/, '')}/${hash}`);
    await expect(guest.getByRole('status')).toHaveText('Connected to New campaign');
    await expect(dm.getByRole('listitem', { name: 'Player seat', exact: true })).toContainText(
      'Online',
    );
    await expect(guest.getByRole('tab', { name: 'Seats', exact: true })).toHaveCount(0);
    expect(frames.join('\n')).not.toContain(hash.slice(hash.indexOf('.') + 1));

    // Regenerating asks first: dismissing the warning leaves the link alone.
    const warning = new Promise<string>((resolve) => {
      dm.once('dialog', (dialog) => {
        resolve(dialog.message());
        void dialog.dismiss();
      });
    });
    await row.getByRole('button', { name: 'Regenerate' }).click();
    expect(await warning).toContain(
      'Regenerate the invite link for Player? The current link stops working.',
    );
    await expect(row).toContainText('Link active');

    await row.getByRole('button', { name: 'Revoke' }).click();
    await expect(invites.getByRole('status')).toHaveText('Invite link revoked.');
    await expect(row).toContainText('No link');
    await expect(row.getByRole('link')).toHaveCount(0);

    // The same link is refused for the next visitor.
    const late = await lateContext.newPage();
    const refused = new Promise<string>((resolve) => {
      late.once('dialog', (dialog) => {
        resolve(dialog.message());
        void dialog.dismiss();
      });
    });
    await late.goto(`${table.clientUrl.replace(/\/$/, '')}/${hash}`);
    expect(await refused).toContain('This invite link is no longer valid.');
  } finally {
    await Promise.all([dmContext.close(), guestContext.close(), lateContext.close()]);
    await table.stop();
  }
});
