import { Campaign } from '../packages/shared/src/index.js';
import { expect, test, type Locator } from '@playwright/test';
import { RawClient, startTable, testUlid, type Table } from './harness.js';

/** Distance in screen pixels between two overlays' centres. */
async function overlayGap(first: Locator, second: Locator): Promise<number> {
  const [a, b] = await Promise.all([first.boundingBox(), second.boundingBox()]);
  if (!a || !b) throw new Error('missing an overlay box');
  return Math.hypot(
    a.x + a.width / 2 - (b.x + b.width / 2),
    a.y + a.height / 2 - (b.y + b.height / 2),
  );
}

let table: Table | undefined;
test.beforeAll(async () => {
  table = await startTable();
});
test.afterAll(async () => {
  await table?.stop();
});

test('the marker picker syncs, persists and never sends private markers', async ({ browser }) => {
  test.setTimeout(60_000);
  if (!table) throw new Error('table not started');
  const identity = { identityId: testUlid('HOST', 1), identitySecret: 'marker-test-host' };
  const host = await RawClient.connect(table, {
    name: 'DM',
    ...identity,
    hostToken: table.hostToken,
  });
  const sceneId = testUlid('SCENE', 1);
  const entityId = testUlid('TOKEN', 1);
  expect(await host.intent('scene.create', { sceneId, name: 'Markers' })).toMatchObject({
    t: 'ack',
  });
  expect(await host.intent('scene.activate', { sceneId })).toMatchObject({ t: 'ack' });
  expect(
    await host.intent('entity.create', {
      sceneId,
      entity: {
        id: entityId,
        layer: 'tokens',
        name: 'Hero',
        owners: [],
        transform: {
          position: { x: 20, y: 0, z: 15 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          scale: { x: 1, y: 1, z: 1 },
        },
        token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
      },
    }),
  ).toMatchObject({ t: 'ack' });
  const observer = await RawClient.connect(table, {
    name: 'Observer',
    identityId: testUlid('OBSERVER', 1),
    identitySecret: 'marker-test-observer',
  });
  await observer.waitFor('initial snapshot', () => observer.state !== undefined);
  const token = (client: RawClient) =>
    Campaign.safeParse(client.state).data?.scenes[sceneId]?.entities[entityId]?.token;
  const context = await browser.newContext();
  await context.addInitScript((value) => {
    localStorage.setItem('mythic.identity.v1', JSON.stringify(value));
    localStorage.setItem('mythic.host', '1');
  }, identity);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(table.clientUrl);
  await page.getByRole('tab', { name: 'Entities', exact: true }).click();
  await page.getByRole('button', { name: 'Hero', exact: true }).click();
  await page.getByRole('button', { name: 'Restore Token panel' }).click();
  const panel = page.getByRole('region', { name: 'Token status markers' });
  await panel.getByLabel('Status icon').selectOption('blinded');
  await panel.getByRole('button', { name: 'Add status icon' }).click();
  await expect(panel.getByRole('button', { name: 'Add status icon' })).toBeDisabled();
  await panel.getByLabel('Custom marker').fill('Moon marked');
  await panel.getByRole('button', { name: 'Add custom marker' }).click();
  await observer.waitFor('public markers', () => token(observer)?.statusMarkers?.length === 2);
  expect(token(observer)?.statusMarkers).toEqual([
    { kind: 'icon', icon: 'blinded' },
    { kind: 'text', text: 'Moon marked' },
  ]);
  // M4-19: the same markers render on the token. The strip is screen-projected, so it is readable
  // at every zoom (CAM-04) instead of shrinking with the board.
  const strip = page.getByTestId('token-status-markers');
  await expect(strip).toBeVisible();
  await expect(page.getByTestId('status-marker')).toHaveText(['◉', 'Moon marked']);
  const stripBox = await strip.boundingBox();
  const canvasBox = await page.locator('canvas').boundingBox();
  if (!stripBox || !canvasBox) throw new Error('missing box for the strip or the canvas');
  const gapBefore = await overlayGap(strip, page.getByTestId('token-label'));
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  await page.mouse.wheel(0, 300);
  await page.mouse.wheel(0, 300);
  await expect(strip).toBeVisible();
  // The camera did zoom out: the token's two screen anchors moved closer together...
  expect(await overlayGap(strip, page.getByTestId('token-label'))).toBeLessThan(gapBefore);
  // ...while the strip keeps the same readable screen size.
  const zoomedBox = await strip.boundingBox();
  expect(zoomedBox?.width).toBeCloseTo(stripBox.width, 0);
  expect(zoomedBox?.height).toBeCloseTo(stripBox.height, 0);
  const publicToken = token(host);
  if (!publicToken) throw new Error('missing host token');
  expect(
    await host.intent('entity.update', {
      sceneId,
      entityId,
      changes: { token: { ...publicToken, labelVisibility: 'dm' } },
    }),
  ).toMatchObject({ t: 'ack' });
  await observer.waitForSeq(host.lastSeq);
  expect(token(observer)?.statusMarkers).toBeUndefined();
  const frameStart = observer.frames.length;
  await panel.getByLabel('Custom marker').fill('Secret curse');
  await panel.getByRole('button', { name: 'Add custom marker' }).click();
  await host.waitFor('private marker edit', () => token(host)?.statusMarkers?.length === 3);
  // M4-19: the DM still sees the marker only they may read.
  await expect(page.getByTestId('status-marker')).toHaveCount(3);
  await observer.waitForSeq(host.lastSeq);
  expect(token(observer)?.statusMarkers).toBeUndefined();
  expect(observer.frames.slice(frameStart).join('\n')).not.toMatch(
    /Secret curse|Moon marked|blinded/,
  );
  const newcomer = await RawClient.connect(table, {
    name: 'New observer',
    identityId: testUlid('OBSERVER', 2),
    identitySecret: 'marker-test-newcomer',
  });
  await newcomer.waitFor('private snapshot', () => newcomer.state !== undefined);
  expect(newcomer.frames.join('\n')).not.toMatch(/Secret curse|Moon marked|blinded/);
  expect(token(newcomer)?.statusMarkers).toBeUndefined();
  // The owner can resize this token, but its DM-only marker list is not theirs to replace.
  const playerIdentity = { identityId: testUlid('PLAYER', 1), identitySecret: 'marker-owner' };
  const seatId = testUlid('SEAT', 1);
  expect(await host.intent('seat.create', { seatId, label: 'Owner' })).toMatchObject({ t: 'ack' });
  expect(
    await host.intent('seat.assign', { seatId, identityId: playerIdentity.identityId }),
  ).toMatchObject({ t: 'ack' });
  expect(
    await host.intent('permission.update', {
      target: 'seat',
      seatId,
      permissions: { edit: true, move: true },
    }),
  ).toMatchObject({ t: 'ack' });
  expect(
    await host.intent('entity.setOwners', { sceneId, entityId, owners: [seatId] }),
  ).toMatchObject({ t: 'ack' });
  const player = await RawClient.connect(table, { name: 'Owner', ...playerIdentity });
  await player.waitFor('owner snapshot', () => token(player) !== undefined);
  expect(token(player)?.statusMarkers).toBeUndefined();
  expect(
    await player.intent('token.setStatusMarkers', {
      sceneId,
      entityId,
      markers: [{ kind: 'text', text: 'Replacement' }],
    }),
  ).toMatchObject({ t: 'reject' });
  const playerContext = await browser.newContext();
  await playerContext.addInitScript(
    ({ identity, seatId }) => {
      localStorage.setItem('mythic.identity.v1', JSON.stringify(identity));
      localStorage.setItem(
        'mythic.profile.v1',
        JSON.stringify({ displayName: 'Owner', lastSeatId: seatId }),
      );
    },
    { identity: playerIdentity, seatId },
  );
  const playerPage = await playerContext.newPage();
  const playerErrors: string[] = [];
  playerPage.on('pageerror', (error) => playerErrors.push(error.message));
  await playerPage.goto(table.clientUrl);
  await expect(playerPage.getByRole('status')).toHaveText('Connected to New campaign');
  await expect(async () => {
    const canvasBox = await playerPage.locator('canvas').boundingBox();
    if (!canvasBox) throw new Error('canvas missing');
    await playerPage.mouse.click(
      canvasBox.x + canvasBox.width / 2,
      canvasBox.y + canvasBox.height / 2,
    );
    // UI-TOKEN-07 (MV-266): the owned token's Transform panel opens in the left pane.
    await expect(
      playerPage
        .getByRole('complementary', { name: 'Left pane' })
        .locator('[data-tool-panel="transform"]'),
    ).toBeVisible({ timeout: 1000 });
  }).toPass();
  await playerPage.getByRole('button', { name: 'Restore Token panel' }).click();
  await expect(playerPage.getByRole('region', { name: 'Token status markers' })).toHaveCount(0);
  await expect(playerPage.getByRole('button', { name: 'Add custom marker' })).toHaveCount(0);
  // M4-19: the host strips the markers for this viewer, so nothing is drawn on their token either.
  await expect(playerPage.getByTestId('token-status-markers')).toHaveCount(0);
  await playerPage.getByLabel('Size (cells)').fill('2');
  await playerPage.getByLabel('Size (cells)').press('Enter');
  await host.waitFor('owner resize', () => token(host)?.sizeCells === 2);
  expect(token(host)?.statusMarkers).toEqual([
    { kind: 'icon', icon: 'blinded' },
    { kind: 'text', text: 'Moon marked' },
    { kind: 'text', text: 'Secret curse' },
  ]);
  await player.waitForSeq(host.lastSeq);
  expect(token(player)?.statusMarkers).toBeUndefined();
  expect(player.frames.join('\n')).not.toMatch(/Secret curse|Moon marked|blinded/);
  const privateToken = token(host);
  expect(
    await host.intent('entity.update', {
      sceneId,
      entityId,
      changes: { token: { ...privateToken, labelVisibility: 'all' } },
    }),
  ).toMatchObject({ t: 'ack' });
  await observer.waitFor('revealed markers', () => token(observer)?.statusMarkers?.length === 3);
  await expect(playerPage.getByRole('region', { name: 'Token status markers' })).toBeVisible();
  // M4-19: once the markers are readable for this audience they appear on the player's token too.
  await expect(playerPage.getByTestId('token-status-markers')).toBeVisible();
  await expect(panel.getByRole('list')).toContainText('Secret curse');
  await panel.getByRole('button', { name: 'Remove marker 3' }).click();
  await observer.waitFor('marker removed', () => token(observer)?.statusMarkers?.length === 2);
  await page.getByRole('button', { name: '3D view' }).click();
  await expect(page.getByRole('button', { name: 'Reset view' })).toBeVisible();
  await expect(panel.getByRole('listitem')).toHaveCount(2);
  // M4-19: the 3D standee carries the same strip, one chip per marker.
  await expect(page.getByTestId('token-status-markers')).toBeVisible();
  await expect(page.getByTestId('status-marker')).toHaveText(['◉', 'Moon marked']);
  await page.reload();
  await page.getByRole('tab', { name: 'Entities', exact: true }).click();
  await page.getByRole('button', { name: 'Hero', exact: true }).click();
  await page.getByRole('button', { name: 'Restore Token panel' }).click();
  await expect(panel.getByRole('listitem')).toHaveCount(2);
  await expect(panel.getByRole('list')).toContainText('Moon marked');
  expect(errors).toEqual([]);
  expect(playerErrors).toEqual([]);
  await playerContext.close();
  await player.close();
  await newcomer.close();
  await observer.close();
  await host.close();
  await context.close();
});
