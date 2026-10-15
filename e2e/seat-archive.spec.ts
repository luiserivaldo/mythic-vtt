import { expect, test } from '@playwright/test';
import { RawClient, startTable, testUlid } from './harness.js';
interface Campaign {
  seats: Record<string, { archived?: boolean; interactionEnabled?: boolean }>;
  scenes: Record<string, { entities: Record<string, { owners: string[] }> }>;
}

test('archive hands back entities and immediately removes co-DM access without leaking archive data', async ({
  browser,
}) => {
  const table = await startTable();
  const context = await browser.newContext();
  try {
    const dm = await context.newPage();
    await dm.goto(`${table.clientUrl}/#host=${table.hostToken}`);
    await expect(dm.getByRole('status')).toHaveText('Connected to New campaign');
    const identity = await dm.evaluate(
      () =>
        JSON.parse(localStorage.getItem('mythic.identity.v1') ?? '{}') as {
          identityId: string;
          identitySecret: string;
        },
    );
    const host = await RawClient.connect(table, { name: 'host', ...identity });
    await host.waitFor('snapshot', () => host.state !== undefined);
    const sceneId = testUlid('SCENE', 191),
      seatId = testUlid('SEAT', 191),
      tokenId = testUlid('TOKEN', 191),
      secretId = testUlid('SECRET', 191);
    await host.intent('scene.create', { sceneId, name: 'Archive scene' });
    await host.intent('scene.activate', { sceneId });
    await host.intent('seat.create', { seatId, label: 'Retiring co-DM', role: 'codm' });
    for (const [id, layer, name] of [
      [tokenId, 'tokens', 'Retained token'],
      [secretId, 'dm', 'SECRET ARCHIVE TOKEN'],
    ]) {
      await host.intent('entity.create', {
        sceneId,
        entity: {
          id,
          layer,
          name,
          owners: [seatId],
          transform: {
            position: { x: 10, y: 0, z: 10 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
          },
          token: {
            sizeCells: 1,
            heightCells: 1,
            labelVisibility: 'all',
            quickFields: { secretstat: { value: 191, visibility: 'owner' } },
          },
        },
      });
    }
    const guestIdentity = {
      identityId: testUlid('LOGIN', 191),
      identitySecret: 'archive-test-login',
    };
    const guest = await RawClient.connect(table, { name: 'guest', ...guestIdentity });
    await guest.waitFor('snapshot', () => guest.state !== undefined);
    // MV-269: only the host grants a co-DM seat.
    await host.intent('seat.assign', { seatId, identityId: guestIdentity.identityId });
    await guest.waitFor('co-DM secret', () =>
      JSON.stringify(guest.state).includes('SECRET ARCHIVE TOKEN'),
    );
    expect(JSON.stringify(guest.state)).toContain('secretstat');
    const base = `http://127.0.0.1:${String(table.hostPort)}`;
    const guestHeaders = {
      authorization: `Mythic ${guestIdentity.identityId}.${guestIdentity.identitySecret}`,
    };
    const inviteResponse = await fetch(`${base}/api/seat-invites/${seatId}`, {
      method: 'POST',
      headers: { authorization: `Mythic ${identity.identityId}.${identity.identitySecret}` },
    });
    expect(inviteResponse.status).toBe(200);
    const { token: inviteToken } = (await inviteResponse.json()) as { token: string };
    guest.frames.length = 0;
    await dm.getByRole('tab', { name: 'Seats', exact: true }).click();
    const participant = dm.getByRole('listitem', { name: 'Retiring co-DM seat' });
    // UI-SEAT-01: the seat's settings open when the seat is expanded.
    await participant.locator('summary').click();
    const interaction = participant.getByRole('checkbox', { name: 'Enable Interaction' });
    await expect(interaction).toBeChecked();
    await interaction.click();
    await expect(interaction).not.toBeChecked();
    await host.waitFor(
      'interaction disabled',
      () => (host.state as Campaign).seats[seatId]?.interactionEnabled === false,
    );
    await dm
      .getByRole('listitem', { name: 'Retiring co-DM seat' })
      .getByRole('button', { name: 'Archive seat' })
      .click();
    const warning = dm.getByRole('dialog', { name: 'Archive Retiring co-DM?' });
    await expect(warning).toContainText('Retained token');
    await expect(warning).toContainText('bound login loses access');
    await warning.getByRole('button', { name: 'Confirm archive' }).click();
    await guest.waitFor(
      'archive snapshot',
      () =>
        !(guest.state as Campaign).seats[seatId] &&
        !JSON.stringify(guest.state).includes('SECRET ARCHIVE TOKEN'),
    );
    await host.waitFor('archived', () => (host.state as Campaign).seats[seatId]?.archived === true);
    expect((host.state as Campaign).scenes[sceneId]?.entities[tokenId]?.owners).toEqual([]);
    expect(guest.frames.join('\n')).not.toContain('SECRET ARCHIVE TOKEN');
    expect(guest.frames.join('\n')).not.toContain('archived');
    expect(guest.frames.join('\n')).not.toContain('secretstat');
    expect(JSON.stringify(host.state)).toContain('secretstat');
    expect((host.state as Campaign).seats[seatId]?.interactionEnabled).toBe(false);
    const redeem = await fetch(`${base}/api/seat-invites/redeem`, {
      method: 'POST',
      headers: { ...guestHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ seatId, token: inviteToken }),
    });
    expect(redeem.status).toBe(404);
    expect(await redeem.json()).toEqual({ error: 'invite unavailable' });
    const upload = await fetch(`${base}/assets/images`, {
      method: 'POST',
      headers: { ...guestHeaders, 'content-type': 'application/octet-stream' },
      body: new Uint8Array([1, 2, 3]),
    });
    expect(upload.status).toBe(403);
    await upload.text();
    const history = await fetch(`${base}/api/history`, { headers: guestHeaders });
    expect(history.status).toBe(200);
    const historyWire = await history.text();
    expect(historyWire).not.toContain('SECRET ARCHIVE TOKEN');
    expect(historyWire).not.toContain('Retiring co-DM');
    expect(historyWire).not.toContain('archived');
    expect(
      (await guest.intent('token.move', { sceneId, entityId: tokenId, to: { x: 11, y: 0, z: 10 } }))
        .t,
    ).toBe('reject');
    await guest.close();
    const again = await RawClient.connect(table, { name: 'guest', ...guestIdentity });
    await again.waitFor('reconnect snapshot', () => again.state !== undefined);
    expect(again.frames.join('\n')).not.toContain('SECRET ARCHIVE TOKEN');
    expect(again.frames.join('\n')).not.toContain('secretstat');
    expect((again.state as Campaign).seats[seatId]).toBeUndefined();
    again.join(seatId);
    await host.intent('scene.rename', { sceneId, name: 'Still archived' });
    await again.waitForSeq(host.lastSeq);
    expect((again.state as Campaign).seats[seatId]).toBeUndefined();
    await again.close();
    await host.close();
  } finally {
    await context.close();
    await table.stop();
  }
});
