import { expect, test } from '@playwright/test';
import { RawClient, startTable, testUlid } from './harness.js';

test('join colour persists and colours the avatar and shared ruler in 2D and 3D', async ({
  browser,
}) => {
  const table = await startTable();
  const dmContext = await browser.newContext();
  const playerContext = await browser.newContext();
  try {
    const dm = await dmContext.newPage();
    await dm.goto(`${table.clientUrl}/#host=${table.hostToken}`);
    await expect(dm.getByRole('status')).toHaveText('Connected to New campaign');
    const identity = await dm.evaluate(
      () =>
        JSON.parse(localStorage.getItem('mythic.identity.v1') ?? '{}') as {
          identityId: string;
          identitySecret: string;
        },
    );
    const setup = await RawClient.connect(table, { name: 'host', ...identity });
    await setup.waitFor('snapshot', () => setup.state !== undefined);
    const seatId = testUlid('SEAT', 217);
    await setup.intent('seat.create', { seatId, label: 'Colour seat' });
    const player = await playerContext.newPage();
    await player.goto(table.clientUrl);
    await expect(player.getByRole('heading', { name: 'Mythic VTT by MythicTomes' })).toBeVisible();
    await player.getByLabel('Display name').fill('Colour Guest');
    await player.getByLabel('Your colour').fill('#c04e32');
    await player.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(player.locator('.join-who .join-avatar')).toHaveCSS(
      'background-color',
      'rgb(192, 78, 50)',
    );
    await player.getByRole('radio', { name: /Colour seat/ }).check();
    await player.getByRole('button', { name: 'Join participant slot' }).click();
    await expect(player.getByRole('dialog')).toHaveCount(0);
    await setup.waitFor('host presence colour', () =>
      setup.frames.some((f) => f.includes('"color":"#c04e32"')),
    );
    await player.getByRole('button', { name: 'Ruler', exact: true }).click();
    await player.getByLabel('Ruler fade').selectOption('linger');
    const box = await player.locator('canvas').boundingBox();
    if (!box) throw new Error('canvas missing');
    const zoom = Math.min(box.width / 42, box.height / 32);
    const x = box.x + box.width / 2 + (5.5 - 20) * zoom,
      y = box.y + box.height / 2 + (5.5 - 15) * zoom;
    await player.mouse.move(x, y);
    await player.mouse.down();
    await player.mouse.move(x + 6 * zoom, y, { steps: 5 });
    await player.mouse.up();
    await expect(player.getByTestId('ruler-total')).toHaveCSS('border-color', 'rgb(192, 78, 50)');
    await expect(dm.getByTestId('remote-ruler-total')).toHaveCSS(
      'border-color',
      'rgb(192, 78, 50)',
    );
    await player.getByRole('button', { name: '3D view' }).click();
    await expect(player.getByTestId('ruler-total')).toHaveCSS('border-color', 'rgb(192, 78, 50)');
    await player.reload();
    await expect(player.getByRole('status')).toHaveText('Connected to New campaign');
    await expect(player.getByRole('dialog')).toHaveCount(0);
    expect(
      await player.evaluate(
        () => JSON.parse(localStorage.getItem('mythic.profile.v1') ?? '{}') as { color: string },
      ),
    ).toMatchObject({ color: '#c04e32' });
    await expect(player.getByRole('heading', { name: 'Mythic VTT', exact: true })).toHaveCount(0);
    await setup.close();
  } finally {
    await playerContext.close();
    await dmContext.close();
    await table.stop();
  }
});

test('a new colour profile cannot join or spectate until the DM activates a scene', async ({
  browser,
}) => {
  const table = await startTable();
  const context = await browser.newContext();
  try {
    const host = await RawClient.connect(table, {
      name: 'host',
      identityId: testUlid('HOST', 218),
      identitySecret: 'join-test-host',
      hostToken: table.hostToken,
    });
    await host.waitFor('snapshot', () => host.state !== undefined);
    const active = testUlid('SCENE', 217),
      spare = testUlid('SCENE', 218);
    await host.intent('scene.create', { sceneId: active, name: 'Lobby' });
    await host.intent('scene.create', { sceneId: spare, name: 'Spare' });
    await host.intent('scene.delete', { sceneId: active });
    const guest = await context.newPage();
    await guest.goto(table.clientUrl);
    await guest.getByLabel('Display name').fill('Waiting Guest');
    await guest.getByLabel('Your colour').fill('#123456');
    await guest.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(guest.getByRole('alert')).toContainText('No active scene');
    await expect(guest.getByRole('button', { name: 'Join as spectator' })).toHaveCount(0);
    await host.intent('scene.activate', { sceneId: spare });
    await guest.getByRole('button', { name: 'Join as spectator' }).click();
    await expect(guest.getByRole('dialog')).toHaveCount(0);
    await guest.reload();
    await expect(
      guest.getByRole('button', { name: 'Spectating: choose a participant slot' }),
    ).toBeVisible();
    await host.close();
  } finally {
    await context.close();
    await table.stop();
  }
});
