import { expect, test } from '@playwright/test';
import { RawClient, openClient, startTable, testUlid, type Table } from './harness.js';
import { HistoryPage } from '../packages/shared/src/index.js';

let table: Table;
test.beforeAll(async () => {
  table = await startTable();
});
test.afterAll(async () => {
  await table.stop();
});

test('history filters, survives restart and excludes private REST content', async ({ browser }) => {
  const identity = { identityId: testUlid('HOST', 1), identitySecret: 'history-test-host' };
  const host = await RawClient.connect(table, {
    name: 'DM',
    ...identity,
    hostToken: table.hostToken,
  });
  const sceneId = testUlid('SCENE', 1);
  const entityId = testUlid('TOKEN', 1);
  const hiddenId = testUlid('TOKEN', 2);
  const seatId = testUlid('SEAT', 1);
  const playerIdentity = {
    identityId: testUlid('PLAYER', 1),
    identitySecret: 'history-test-player',
  };
  expect(await host.intent('scene.create', { sceneId, name: 'History scene' })).toMatchObject({
    t: 'ack',
  });
  expect(await host.intent('scene.activate', { sceneId })).toMatchObject({ t: 'ack' });
  expect(await host.intent('seat.create', { seatId, label: 'Aria' })).toMatchObject({ t: 'ack' });
  expect(
    await host.intent('seat.assign', { seatId, identityId: playerIdentity.identityId }),
  ).toMatchObject({ t: 'ack' });
  for (const [id, name, layer] of [
    [entityId, 'History hero', 'tokens'],
    [hiddenId, 'Secret warden', 'dm'],
  ] as const) {
    expect(
      await host.intent('entity.create', {
        sceneId,
        entity: {
          id,
          name,
          layer,
          owners: [seatId],
          transform: {
            position: { x: 20, y: 0, z: 15 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
          },
          token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
        },
      }),
    ).toMatchObject({ t: 'ack' });
  }
  const player = await RawClient.connect(table, { name: 'Aria', ...playerIdentity });
  await player.waitFor('player snapshot', () => player.state !== undefined);
  expect(
    await player.intent('token.move', { sceneId, entityId, to: { x: 21, y: 0, z: 15 } }),
  ).toMatchObject({ t: 'ack' });
  const context = await browser.newContext();
  await context.addInitScript((value) => {
    localStorage.setItem('mythic.identity.v1', JSON.stringify(value));
    localStorage.setItem('mythic.host', '1');
  }, identity);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(table.clientUrl);
  await page.getByRole('button', { name: 'History', exact: true }).click();
  const history = page.getByRole('region', { name: 'Action history' });
  await expect(history.getByText('entity.create', { exact: false }).first()).toBeVisible();
  await history.getByLabel('History seat').selectOption(seatId);
  await history.getByRole('button', { name: 'Refresh history' }).click();
  await expect(history.locator('summary')).toHaveCount(1);
  await expect(history.locator('summary')).toContainText('token.move');
  await history.locator('summary').click();
  await expect(history).toContainText('/transform/position');
  const spectator = await openClient(browser, table, 'spectator');
  const responses: string[] = [];
  spectator.page.on('response', (response) => {
    if (response.url().includes('/api/history'))
      void response.text().then((body) => {
        responses.push(body);
      });
  });
  await spectator.page.getByRole('button', { name: 'History', exact: true }).click();
  const spectatorHistory = spectator.page.getByRole('region', { name: 'Action history' });
  await expect(spectatorHistory.locator('summary').first()).toBeVisible();
  await expect.poll(() => responses.length).toBeGreaterThan(0);
  expect(responses.join('\n')).not.toMatch(
    new RegExp(`Secret warden|${hiddenId}|identityId|inversePatches|clientRef`),
  );
  const spectatorIdentity = await spectator.page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('mythic.identity.v1') ?? '{}') as {
        identityId: string;
        identitySecret: string;
      },
  );
  const endpoint = `${table.clientUrl}/api/history`;
  const headers = {
    Authorization: `Mythic ${spectatorIdentity.identityId}.${spectatorIdentity.identitySecret}`,
  };
  expect((await spectator.page.request.get(endpoint)).status()).toBe(401);
  expect(
    (
      await spectator.page.request.get(endpoint, {
        headers: { ...headers, Origin: 'https://other.example' },
      })
    ).status(),
  ).toBe(403);
  expect((await spectator.page.request.get(`${endpoint}?limit=999`, { headers })).status()).toBe(
    400,
  );
  const filtered = await spectator.page.request.get(`${endpoint}?entityId=${hiddenId}`, {
    headers,
  });
  expect(HistoryPage.parse(await filtered.json()).entries).toEqual([]);
  expect(await host.intent('entity.setLayer', { sceneId, entityId, layer: 'dm' })).toMatchObject({
    t: 'ack',
  });
  const nowPrivate = await spectator.page.request.get(endpoint, { headers });
  expect(JSON.stringify(await nowPrivate.json())).not.toMatch(
    new RegExp(`History hero|${entityId}|Secret warden|${hiddenId}`),
  );
  expect(await host.intent('entity.delete', { sceneId, entityId })).toMatchObject({ t: 'ack' });
  const deletedPrivate = await spectator.page.request.get(endpoint, { headers });
  expect(JSON.stringify(await deletedPrivate.json())).not.toMatch(
    new RegExp(`History hero|${entityId}`),
  );
  await player.close();
  await host.close();
  await table.restart();
  await page.reload();
  await expect(page.getByRole('status')).toHaveText('Connected to New campaign');
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await history.getByLabel('History seat').selectOption(seatId);
  await history.getByRole('button', { name: 'Refresh history' }).click();
  await expect(history.locator('summary')).toHaveCount(1);
  await expect(history.locator('summary')).toContainText('token.move');
  expect(errors).toEqual([]);
  await spectator.context.close();
  await context.close();
});
