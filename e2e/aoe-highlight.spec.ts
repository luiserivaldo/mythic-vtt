import { expect, test } from '@playwright/test';
import { RawClient, startTable, testUlid, type Table } from './harness.js';

let table: Table;

test.beforeAll(async () => {
  table = await startTable();
});
test.afterAll(async () => {
  await table.stop();
});

// M3-05 / MEAS-04: use the printed DM link so this follows the real host UI path, then verify
// client-derived affected names follow authoritative AoE state in both render modes.
test('the DM link shows live AoE affected tokens in 2D and 3D', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${table.clientUrl.replace(/\/$/, '')}/#host=${table.hostToken}`);
  await expect(page.getByRole('status')).toHaveText('Connected to New campaign');
  const identity = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('mythic.identity.v1') ?? '{}') as {
        identityId: string;
        identitySecret: string;
      },
  );
  const host = await RawClient.connect(table, { name: 'aoe-highlight-host', ...identity });
  try {
    await host.waitFor('host snapshot', () => host.state !== undefined);
    const sceneId = testUlid('SCENE', 505);
    const insideId = testUlid('TOKEN', 501);
    const outsideId = testUlid('TOKEN', 502);
    const aoeId = identity.identityId;
    const transform = (x: number, y: number, z: number) => ({
      position: { x, y, z },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    });
    expect((await host.intent('scene.create', { sceneId, name: 'Affected board' })).t).toBe('ack');
    for (const entity of [
      {
        id: insideId,
        layer: 'tokens',
        name: 'Inside hero',
        owners: [],
        transform: transform(8, 0, 8),
        token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
      },
      {
        id: outsideId,
        layer: 'tokens',
        name: 'Outside hero',
        owners: [],
        transform: transform(14, 0, 8),
        token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
      },
    ]) {
      expect((await host.intent('entity.create', { sceneId, entity })).t).toBe('ack');
    }
    expect(
      (
        await host.intent('aoe.place', {
          sceneId,
          entity: {
            id: aoeId,
            layer: 'effects',
            name: 'Test sphere',
            owners: [],
            transform: transform(8, 0, 8),
            aoe: { kind: 'sphere', radius: 2, color: '#ff7744' },
          },
        })
      ).t,
    ).toBe('ack');

    // M3-15 / UI-MEAS-06: AoE controls and affected-token readouts live in the Measure panel,
    // beside the rail.
    await page.getByRole('button', { name: 'Measure', exact: true }).click();
    await page.getByRole('radio', { name: 'Circle', exact: true }).check();
    const panel = page
      .getByRole('complementary', { name: 'Measure', exact: true })
      .getByRole('region', { name: 'Affected tokens' });
    await expect(panel.getByText('Inside hero')).toBeVisible();
    await expect(panel.getByText('Outside hero')).toHaveCount(0);
    await expect(panel).toContainText('1 token');

    expect(
      (
        await host.intent('aoe.update', {
          sceneId,
          entityId: aoeId,
          changes: { transform: transform(14, 0, 8) },
        })
      ).t,
    ).toBe('ack');
    await expect(panel.getByText('Outside hero')).toBeVisible();
    await expect(panel.getByText('Inside hero')).toHaveCount(0);

    // MEAS-04: moving a token (not the AoE) refreshes the list in both directions.
    expect(
      (
        await host.intent('entity.update', {
          sceneId,
          entityId: insideId,
          changes: { transform: transform(14, 0, 8) },
        })
      ).t,
    ).toBe('ack');
    await expect(panel.getByText('Inside hero', { exact: true })).toBeVisible();
    await expect(panel).toContainText('2 tokens');
    expect(
      (
        await host.intent('entity.update', {
          sceneId,
          entityId: insideId,
          changes: { transform: transform(8, 0, 8) },
        })
      ).t,
    ).toBe('ack');
    await expect(panel.getByText('Inside hero', { exact: true })).toHaveCount(0);
    await expect(panel).toContainText('1 token');
    await page.screenshot({ path: '/tmp/mythic-m3-05-aoe-highlight-2d.png' });

    const viewToggle = page.getByRole('button', { name: '3D view' });
    await viewToggle.click();
    await expect(panel.getByText('Outside hero')).toBeVisible();
    await expect(viewToggle).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Reset view' }).click();
    await page.waitForTimeout(350);
    await page.screenshot({ path: '/tmp/mythic-m3-12-aoe-highlight-3d.png' });
    expect(errors).toEqual([]);
  } finally {
    await host.close();
    await context.close();
  }
});

// D35 / MEAS-04: the same panel must redact a name the viewer may not read and must not list a
// token the viewer cannot see at all, working from the host's already-filtered scene.
test('D35: a player sees a placeholder for an unreadable label and nothing for an invisible token', async ({
  browser,
}) => {
  // The host token is single use (D24), so this test owns its table instead of sharing the file's.
  test.setTimeout(60_000);
  const d35Table = await startTable();
  const sceneId = testUlid('SCENE', 506);
  const seatId = testUlid('SEAT', 506);
  const dmIdentity = { identityId: testUlid('HOST', 506), identitySecret: 'aoe-d35-host-secret' };
  const playerIdentity = {
    identityId: testUlid('PLAYER', 506),
    identitySecret: 'aoe-d35-player-secret',
  };
  const readableId = testUlid('TOKEN', 511);
  const ownerOnlyId = testUlid('TOKEN', 512);
  const dmLayerId = testUlid('TOKEN', 513);
  // M3-14: an AoE belongs to the identity that placed it, so its id is that identity.
  const aoeId = dmIdentity.identityId;
  const transform = (x: number, y: number, z: number) => ({
    position: { x, y, z },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  });
  const host = await RawClient.connect(d35Table, {
    name: 'aoe-d35-host',
    ...dmIdentity,
    hostToken: d35Table.hostToken,
  });
  const dmContext = await browser.newContext();
  const playerContext = await browser.newContext();
  try {
    await host.waitFor('host snapshot', () => host.state !== undefined);
    expect((await host.intent('scene.create', { sceneId, name: 'D35 board' })).t).toBe('ack');
    expect((await host.intent('scene.activate', { sceneId })).t).toBe('ack');
    expect((await host.intent('seat.create', { seatId, label: 'Aria' })).t).toBe('ack');
    expect(
      (await host.intent('seat.assign', { seatId, identityId: playerIdentity.identityId })).t,
    ).toBe('ack');
    for (const entity of [
      {
        id: readableId,
        layer: 'tokens',
        name: 'Readable hero',
        owners: [],
        transform: transform(8, 0, 8),
        token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
      },
      {
        id: ownerOnlyId,
        layer: 'tokens',
        name: 'Owner-only hero',
        owners: [],
        transform: transform(8.5, 0, 8),
        token: { sizeCells: 1, heightCells: 1, labelVisibility: 'owner' },
      },
      {
        id: dmLayerId,
        layer: 'dm',
        name: 'Hidden heir',
        owners: [],
        transform: transform(8, 0, 9),
        token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
      },
    ]) {
      expect((await host.intent('entity.create', { sceneId, entity })).t).toBe('ack');
    }
    expect(
      (
        await host.intent('aoe.place', {
          sceneId,
          entity: {
            id: aoeId,
            layer: 'effects',
            name: 'D35 sphere',
            owners: [],
            transform: transform(8, 0, 8),
            aoe: { kind: 'sphere', radius: 2, color: '#ff7744' },
          },
        })
      ).t,
    ).toBe('ack');

    await dmContext.addInitScript((identity) => {
      localStorage.setItem('mythic.identity.v1', JSON.stringify(identity));
      localStorage.setItem('mythic.host', '1');
    }, dmIdentity);
    const dm = await dmContext.newPage();
    // A saved profile skips the join screen; the host binds the seat by identity (SES-04).
    await playerContext.addInitScript(
      ({ identity, seat }: { identity: typeof playerIdentity; seat: string }) => {
        localStorage.setItem('mythic.identity.v1', JSON.stringify(identity));
        localStorage.setItem(
          'mythic.profile.v1',
          JSON.stringify({ displayName: 'Aria', lastSeatId: seat }),
        );
      },
      { identity: playerIdentity, seat: seatId },
    );
    const player = await playerContext.newPage();
    const errors: string[] = [];
    for (const page of [dm, player]) page.on('pageerror', (error) => errors.push(error.message));
    await dm.goto(d35Table.clientUrl);
    await player.goto(d35Table.clientUrl);
    await expect(dm.locator('canvas')).toBeVisible();
    await expect(player.locator('canvas')).toBeVisible();

    // The DM view is unfiltered, which also proves the AoE really covers all three tokens.
    await dm.getByRole('button', { name: 'Measure', exact: true }).click();
    const dmPanel = dm.getByRole('region', { name: 'Affected tokens' });
    await expect(dmPanel.getByText('Readable hero', { exact: true })).toBeVisible();
    await expect(dmPanel.getByText('Owner-only hero', { exact: true })).toBeVisible();
    await expect(dmPanel.getByText('Hidden heir', { exact: true })).toBeVisible();
    await expect(dmPanel.getByTestId('aoe-affected-token')).toHaveCount(3);
    await expect(dmPanel).toContainText('3 tokens');

    // The player owns nothing here: one readable name, one neutral placeholder, and nothing at
    // all for the token on the DM layer.
    await player.keyboard.press('r');
    const playerPanel = player.getByRole('region', { name: 'Affected tokens' });
    const rows = playerPanel.getByTestId('aoe-affected-token');
    await expect(rows).toHaveCount(2);
    await expect(playerPanel).toContainText('2 tokens');
    await expect(playerPanel.getByText('Readable hero', { exact: true })).toBeVisible();
    await expect(playerPanel.getByText('Unknown token', { exact: true })).toBeVisible();
    await expect(playerPanel.getByText('Owner-only hero')).toHaveCount(0);
    await expect(playerPanel.getByText('Hidden heir')).toHaveCount(0);
    await expect(rows.filter({ hasText: 'Readable hero' })).toContainText('0 ft');
    await expect(rows.filter({ hasText: 'Unknown token' })).toContainText('2.5 ft');

    // Moving a token out of the AoE updates both viewers, and moving it back restores it.
    expect(
      (
        await host.intent('entity.update', {
          sceneId,
          entityId: readableId,
          changes: { transform: transform(30, 0, 30) },
        })
      ).t,
    ).toBe('ack');
    await expect(rows).toHaveCount(1);
    await expect(playerPanel.getByText('Readable hero')).toHaveCount(0);
    await expect(dmPanel.getByText('Readable hero', { exact: true })).toHaveCount(0);
    await expect(dmPanel).toContainText('2 tokens');
    expect(
      (
        await host.intent('entity.update', {
          sceneId,
          entityId: readableId,
          changes: { transform: transform(8, 0, 8) },
        })
      ).t,
    ).toBe('ack');
    await expect(rows).toHaveCount(2);
    await expect(playerPanel).toContainText('2 tokens');
    expect(errors).toEqual([]);
  } finally {
    await host.close();
    await dmContext.close();
    await playerContext.close();
    await d35Table.stop();
  }
});
