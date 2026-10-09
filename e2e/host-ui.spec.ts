import { expect, test } from '@playwright/test';
import { openClient, RawClient, startTable, testUlid, type Table } from './harness.js';

// D24/D33: the DM link (`#host=<token>`) must make the browser the host and reveal the DM panels.
// This path once crashed with "Maximum call stack size exceeded" (setHost re-entered its own
// store subscription), and nothing caught it because every other e2e client is a viewer.
let table: Table | undefined;

test.beforeAll(async () => {
  table = await startTable();
});

test.afterAll(async () => {
  await table?.stop();
});

test('the DM link makes the browser host: panels appear, the token leaves the URL, no page errors', async ({
  browser,
}) => {
  if (!table) throw new Error('table not started');
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`${table.clientUrl.replace(/\/$/, '')}/#host=${table.hostToken}`);
  await expect(page.getByRole('status')).toHaveText('Connected to New campaign');
  for (const panel of ['Scenes', 'Layers', 'Map', 'Participants']) {
    await expect(page.getByText(panel, { exact: true }).first()).toBeVisible();
  }
  expect(page.url()).not.toContain('host=');
  expect(await page.evaluate(() => localStorage.getItem('mythic.host'))).toBe('1');

  // M1-26: use the identity authenticated by the DM link to prepare a real player seat, then
  // submit a host-only action from that player's dev overlay. The shared submit boundary must
  // turn the host reject into an accessible toast and retain it in recent-intent diagnostics.
  const hostIdentity = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('mythic.identity.v1') ?? '{}') as {
        identityId: string;
        identitySecret: string;
      },
  );
  const playerIdentity = {
    identityId: testUlid('PLAYER', 1),
    identitySecret: 'player-secret',
  };
  const sceneId = testUlid('SCENE', 1);
  const seatId = testUlid('SEAT', 1);
  const setup = await RawClient.connect(table, { name: 'host setup', ...hostIdentity });
  await setup.waitFor('host setup snapshot', () => setup.state !== undefined);
  await setup.intent('scene.create', { sceneId, name: 'Reject test' });
  await setup.intent('scene.activate', { sceneId });
  await setup.intent('seat.create', { seatId, label: 'Player' });
  await setup.intent('seat.assign', { seatId, identityId: playerIdentity.identityId });

  const playerContext = await browser.newContext();
  await playerContext.addInitScript((identity) => {
    localStorage.setItem('mythic.identity.v1', JSON.stringify(identity));
    localStorage.setItem(
      'mythic.profile.v1',
      JSON.stringify({ displayName: 'Player', spectator: true }),
    );
  }, playerIdentity);
  const playerPage = await playerContext.newPage();
  await playerPage.goto(`${table.clientUrl}?dev=1`);
  await expect(playerPage.getByRole('status')).toHaveText('Connected to New campaign');
  await playerPage.getByRole('button', { name: 'Test rejection' }).click();
  await expect(playerPage.getByRole('alert')).toContainText(
    'The host did not accept that (forbidden).',
  );
  await expect(
    playerPage.getByRole('complementary', { name: 'Developer diagnostics' }),
  ).toContainText('scene.rename');
  await expect(
    playerPage.getByRole('complementary', { name: 'Developer diagnostics' }),
  ).toContainText('reject (forbidden)');

  // A plain visitor on the same table is not the host and gets no DM panels.
  const viewer = await openClient(browser, table, 'viewer');
  await expect(viewer.page.getByRole('status')).toHaveText('Connected to New campaign');
  await expect(viewer.page.getByText('Participants', { exact: true })).toHaveCount(0);

  expect(errors).toEqual([]);
  await setup.close();
  await playerContext.close();
  await viewer.context.close();
  await context.close();
});
