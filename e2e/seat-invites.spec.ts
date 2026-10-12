import { expect, test } from '@playwright/test';
import { RawClient, startTable, testUlid, type Reply } from './harness.js';

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
