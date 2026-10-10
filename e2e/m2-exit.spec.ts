import { expect, test } from '@playwright/test';
import {
  RawClient,
  openClient,
  recordPageFrames,
  startTable,
  testUlid,
  type Table,
} from './harness.js';

let table: Table | undefined;
test.beforeAll(async () => {
  table = await startTable();
});
test.afterAll(async () => {
  await table?.stop();
});

// M2-11: automated exit gate; human review of prototype readability remains separate.
test('DM, player and spectator keep shared state and privacy across independent 2D/3D toggles', async ({
  browser,
}) => {
  if (!table) throw new Error('table not started');
  const identity = { identityId: testUlid('HOST', 1), identitySecret: 'exit-test-host' };
  const setup = await RawClient.connect(table, {
    name: 'DM',
    ...identity,
    hostToken: table.hostToken,
  });
  const sceneId = testUlid('SCENE', 1);
  await setup.intent('scene.create', { sceneId, name: 'M2 exit' });
  await setup.intent('scene.activate', { sceneId });
  const seatId = testUlid('SEAT', 1);
  await setup.intent('seat.create', { seatId, label: 'Wizard' });
  for (const [index, layer] of ['tokens', 'dm'].entries()) {
    await setup.intent('entity.create', {
      sceneId,
      entity: {
        id: testUlid('TOKEN', index + 1),
        layer,
        name: layer === 'dm' ? 'Secret sentinel' : 'Elevated sentinel',
        owners: [seatId],
        transform: {
          position: { x: 20 + index * 2, y: 3, z: 15 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          scale: { x: 1, y: 1, z: 1 },
        },
        token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
      },
    });
  }
  const dmContext = await browser.newContext();
  await dmContext.addInitScript((value) => {
    localStorage.setItem('mythic.identity.v1', JSON.stringify(value));
    localStorage.setItem('mythic.host', '1');
  }, identity);
  const dm = await dmContext.newPage();
  const player = await openClient(browser, table, 'player', { joinScreen: true });
  const spectator = await openClient(browser, table, 'spectator', { joinScreen: true });
  const frames = [recordPageFrames(player.page), recordPageFrames(spectator.page)];
  const pages = [dm, player.page, spectator.page];
  const errors: string[] = [];
  for (const page of pages) page.on('pageerror', (error) => errors.push(error.message));
  await dm.goto(table.clientUrl);
  await spectator.page.getByLabel('Display name').fill('Spectator');
  await spectator.page.getByRole('button', { name: 'Continue' }).click();
  await spectator.page.getByRole('button', { name: 'Join as spectator' }).click();
  await player.page.getByLabel('Display name').fill('Player');
  await player.page.getByRole('button', { name: 'Continue' }).click();
  await player.page.getByRole('radio', { name: /Wizard/ }).check();
  await player.page.getByRole('button', { name: 'Join participant slot', exact: true }).click();
  for (const page of pages) {
    await expect(page.getByRole('status')).toHaveText('Connected to New campaign');
    await expect(
      page.getByTestId('token-label').filter({ hasText: 'Elevated sentinel' }),
    ).toHaveCount(1);
    await expect(page.getByTestId('elevation-badge').first()).toContainText('15 ft');
  }
  await dm.getByRole('button', { name: '3D view' }).click();
  await expect(dm.getByRole('button', { name: 'Reset view' })).toBeVisible();
  await expect(player.page.getByRole('button', { name: '3D view' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  for (const page of [player.page, spectator.page]) {
    await page.getByRole('button', { name: '3D view' }).click();
    await expect(page.getByRole('button', { name: 'Reset view' })).toBeVisible();
  }
  // Sync while every participant uses the perspective renderer.
  const update = await setup.intent(
    'token.setElevation',
    { sceneId, entityId: testUlid('TOKEN', 1), elevation: 4 },
    sceneId,
  );
  expect(update.t).toBe('ack');
  for (const captured of frames) {
    await expect
      .poll(() =>
        captured.some((raw) => {
          const message = JSON.parse(raw) as { t?: string; seq?: number };
          return message.t === 'patch' && message.seq === update.seq;
        }),
      )
      .toBe(true);
  }
  for (const page of pages) {
    await expect(
      page.getByTestId('token-label').filter({ hasText: 'Elevated sentinel' }),
    ).toHaveCount(1);
    await page.getByRole('button', { name: '3D view' }).click();
    await expect(page.getByRole('button', { name: 'Reset view' })).toHaveCount(0);
    await expect(page.getByTestId('elevation-badge').filter({ hasText: '20 ft' })).toHaveCount(1);
  }
  await player.page.reload();
  await expect(player.page.getByLabel('Current identity')).toContainText('Wizard');
  await expect(player.page.getByTestId('elevation-badge')).toContainText('20 ft');
  for (const page of [player.page, spectator.page])
    await expect(
      page.getByTestId('token-label').filter({ hasText: 'Secret sentinel' }),
    ).toHaveCount(0);
  for (const captured of frames) {
    expect(captured.join('\n')).not.toContain('Secret sentinel');
    expect(captured.join('\n')).not.toContain(testUlid('TOKEN', 2));
  }
  expect(errors).toEqual([]);
  await setup.close();
  await dmContext.close();
  await player.context.close();
  await spectator.context.close();
});
