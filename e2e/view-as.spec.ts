import { expect, test } from '@playwright/test';
import { RawClient, startTable, testUlid } from './harness.js';

test('UX-14 replaces the DM view with live seat/spectator filtering and always permits return', async ({
  browser,
}) => {
  const table = await startTable();
  const context = await browser.newContext();
  const page = await context.newPage();
  const clients: RawClient[] = [];
  try {
    await page.goto(`${table.clientUrl}/#host=${table.hostToken}`);
    await expect(page.getByRole('status')).toHaveText('Connected to New campaign');
    const identity = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('mythic.identity.v1') ?? '{}') as {
          identityId: string;
          identitySecret: string;
        },
    );
    const host = await RawClient.connect(table, { name: 'setup', ...identity });
    clients.push(host);
    await host.waitFor('snapshot', () => host.state !== undefined);
    const sceneId = (host.state as { activeSceneId: string }).activeSceneId;
    const aliceSeat = testUlid('SEAT', 200),
      bobSeat = testUlid('SEAT', 201),
      coDmSeat = testUlid('SEAT', 202);
    for (const [seatId, label, role] of [
      [aliceSeat, 'Alice', 'player'],
      [bobSeat, 'Bob', 'player'],
      [coDmSeat, 'Co-DM', 'codm'],
    ]) {
      expect(await host.intent('seat.create', { seatId, label, role })).toMatchObject({ t: 'ack' });
    }
    const secretId = testUlid('SECRET', 200),
      aliceId = testUlid('TOKEN', 200),
      bobId = testUlid('TOKEN', 201);
    for (const [id, name, owner, layer, x] of [
      [secretId, 'DM secret UX14', null, 'dm', 16],
      [aliceId, 'Alice private UX14', aliceSeat, 'tokens', 20],
      [bobId, 'Bob private UX14', bobSeat, 'tokens', 24],
    ] as const) {
      expect(
        await host.intent('entity.create', {
          sceneId,
          entity: {
            id,
            name,
            layer,
            owners: owner ? [owner] : [],
            transform: {
              position: { x, y: 0, z: 15 },
              rotation: { x: 0, y: 0, z: 0, w: 1 },
              scale: { x: 1, y: 1, z: 1 },
            },
            token: { sizeCells: 1, heightCells: 1, labelVisibility: owner ? 'owner' : 'dm' },
          },
        }),
      ).toMatchObject({ t: 'ack' });
    }
    const inactive = testUlid('SCENE', 200);
    expect(
      await host.intent('scene.create', { sceneId: inactive, name: 'Inactive secret UX14' }),
    ).toMatchObject({ t: 'ack' });
    const alice = await RawClient.connect(table, {
      name: 'Alice',
      identityId: testUlid('IDENTITY', 200),
      identitySecret: 'alice-test-secret',
    });
    clients.push(alice);
    await alice.waitFor('snapshot', () => alice.state !== undefined);
    alice.join(aliceSeat);
    await alice.waitFor('seated', () =>
      alice.frames.some((frame) => frame.includes(`"seatId":"${aliceSeat}"`)),
    );
    const headers = {
      Authorization: `Mythic ${identity.identityId}.${identity.identitySecret}`,
      'content-type': 'application/json',
    };
    const origin = `http://127.0.0.1:${String(table.hostPort)}`;
    // No JSON content-type: the route takes no body, and Fastify rejects an empty JSON one.
    const link = await fetch(`${origin}/api/spectator-link`, {
      method: 'POST',
      headers: { Authorization: headers.Authorization },
    });
    expect(link.status).toBe(200);
    const { token } = (await link.json()) as { token: string };
    const spectator = await RawClient.connect(table, {
      name: 'Spectator',
      identityId: testUlid('WATCH', 200),
      identitySecret: 'watch-test-secret',
      watchToken: token,
    });
    clients.push(spectator);
    await spectator.waitFor('snapshot', () => spectator.state !== undefined);
    const labels = page.getByTestId('token-label');
    await expect
      .poll(async () => (await labels.allTextContents()).sort())
      .toEqual(['DM secret UX14', 'Alice private UX14', 'Bob private UX14'].sort());
    await page.getByRole('button', { name: 'View as', exact: true }).click();
    const picker = page.getByRole('combobox', { name: 'View as audience' });
    await expect(
      page.getByRole('combobox', { name: 'View as mode' }).locator('option[value="new-tab"]'),
    ).toHaveAttribute('disabled', '');
    await picker.selectOption(`seat:${aliceSeat}`);
    await expect(page.getByText('Viewing as Alice · Read only')).toBeVisible();
    await expect(labels).toHaveText(['Alice private UX14']);
    await expect(page.getByRole('tab', { name: 'Scenes', exact: true })).toHaveCount(0);
    expect(JSON.stringify(alice.state)).not.toContain('DM secret UX14');
    expect(JSON.stringify(alice.state)).not.toContain('Bob private UX14');
    expect(JSON.stringify(alice.state)).not.toContain('Inactive secret UX14');
    await page.getByRole('button', { name: '3D view' }).click();
    await expect(labels).toHaveText(['Alice private UX14']);
    await page.getByRole('button', { name: '2D view' }).click();
    expect(
      await host.intent('entity.update', {
        sceneId,
        entityId: aliceId,
        changes: { name: 'Alice updated UX14' },
      }),
    ).toMatchObject({ t: 'ack' });
    await expect(labels).toHaveText(['Alice updated UX14']);
    await alice.waitForSeq(host.lastSeq);
    expect(JSON.stringify(alice.state)).toContain('Alice updated UX14');
    await picker.selectOption(`seat:${bobSeat}`);
    await expect(labels).toHaveText(['Bob private UX14']);
    await picker.selectOption('spectators');
    await expect(page.getByText('Viewing as Spectator · Read only')).toBeVisible();
    await expect(labels).toHaveCount(0);
    expect(JSON.stringify(spectator.state)).not.toContain('Alice updated UX14');
    await page.getByRole('tab', { name: 'Settings', exact: true }).click();
    await expect(page.getByText('Back to DM to view history.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'View as', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Back to DM', exact: true }).click();
    await expect
      .poll(async () => (await labels.allTextContents()).sort())
      .toEqual(['DM secret UX14', 'Alice updated UX14', 'Bob private UX14'].sort());
    // Spectators can follow a configured player seat; preview resolves that existing backend setting.
    const changed = await fetch(`${origin}/api/spectator-view`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ seatId: aliceSeat }),
    });
    expect(changed.status).toBe(200);
    await changed.arrayBuffer();
    await picker.selectOption('spectators');
    // PERM-04/M4-02: the preview renders the spectators audience exactly as a real spectator does.
    // A spectator who watches through a seat is never told it holds that seat (M4-02, engine
    // `snapshotFor`), so it stays a spectator for label rules and reads no owner-only label (D35):
    // it sees Alice's token, and the name reaches its state (checked below), but not on a label.
    await expect(picker).toHaveValue('spectators');
    await expect(labels).toHaveCount(0);
    await spectator.waitFor('new audience', () =>
      JSON.stringify(spectator.state).includes('Alice updated UX14'),
    );
    await picker.selectOption(`seat:${coDmSeat}`);
    await expect
      .poll(async () => (await labels.allTextContents()).sort())
      .toEqual(['DM secret UX14', 'Alice updated UX14', 'Bob private UX14'].sort());
    await page.getByRole('button', { name: 'Back to DM', exact: true }).click();
    // Actual non-DM connections continue to receive filtered frames even while the DM previews.
    for (const client of [alice, spectator]) {
      expect(client.frames.join('\n')).not.toContain(secretId);
      expect(client.frames.join('\n')).not.toContain('DM secret UX14');
    }
  } finally {
    await Promise.all(clients.map((client) => client.close()));
    await context.close();
    await table.stop();
  }
});
