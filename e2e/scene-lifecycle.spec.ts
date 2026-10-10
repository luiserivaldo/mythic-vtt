import { expect, test } from '@playwright/test';
import { RawClient, openClient, recordPageFrames, startTable, testUlid } from './harness.js';

test('DM browsing stays local, deleted player scene becomes empty, and new joins are blocked', async ({
  browser,
}) => {
  const table = await startTable();
  const dmContext = await browser.newContext();
  const dm = await dmContext.newPage();
  const clients: RawClient[] = [];
  const errors: string[] = [];
  dm.on('pageerror', (error) => errors.push(error.message));
  try {
    await dm.goto(`${table.clientUrl}/#host=${table.hostToken}`);
    await expect(dm.getByRole('status')).toHaveText('Connected to New campaign');
    await expect(dm.getByLabel('Current scene', { exact: true })).toHaveText('Blank scene');
    const identity = await dm.evaluate(
      () =>
        JSON.parse(localStorage.getItem('mythic.identity.v1') ?? '{}') as {
          identityId: string;
          identitySecret: string;
        },
    );
    const host = await RawClient.connect(table, { name: 'DM', ...identity });
    clients.push(host);
    await host.waitFor('snapshot', () => host.state !== undefined);
    const state = host.state as { activeSceneId: string };
    const active = state.activeSceneId;
    const seatId = testUlid('SEAT', 90);
    expect(await host.intent('seat.create', { seatId, label: 'Player' })).toMatchObject({
      t: 'ack',
    });
    const player = await openClient(browser, table, 'lifecycle-player', { joinScreen: true });
    const frames = recordPageFrames(player.page);
    player.page.on('pageerror', (error) => errors.push(error.message));
    await player.page.getByLabel('Display name').fill('Aria');
    await player.page.getByRole('button', { name: 'Continue', exact: true }).click();
    await player.page.getByRole('radio', { name: /Player/ }).check();
    await player.page.getByRole('button', { name: 'Join seat', exact: true }).click();
    await expect(player.page.getByRole('dialog')).toHaveCount(0);
    const privateId = testUlid('SECRET', 90);
    expect(
      await host.intent('scene.create', {
        sceneId: privateId,
        name: 'SECRET-PRIVATE-SCENE',
        dmOnly: true,
      }),
    ).toMatchObject({ t: 'ack' });
    const privateEntity = testUlid('PRIVATEBOX', 90);
    expect(
      await host.intent('entity.create', {
        sceneId: privateId,
        entity: {
          id: privateEntity,
          name: 'SECRET-PRIVATE-PROP',
          layer: 'props',
          owners: [],
          transform: {
            position: { x: 1, y: 0, z: 1 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
          },
          shape: { kind: 'box', color: '#667788', walkable: false },
        },
      }),
    ).toMatchObject({ t: 'ack' });
    await dm.getByRole('button', { name: 'Scenes', exact: true }).click();
    const secret = dm.getByRole('listitem').filter({ hasText: 'SECRET-PRIVATE-SCENE' });
    await secret.getByRole('button', { name: 'Browse', exact: true }).click();
    await expect(dm.getByLabel('Current scene', { exact: true })).toHaveText(
      'SECRET-PRIVATE-SCENE',
    );
    await expect(player.page.getByLabel('Current scene', { exact: true })).toHaveText(
      'Blank scene',
    );
    await dm.getByRole('button', { name: '3D view', exact: true }).click();
    await player.page.getByRole('button', { name: '3D view', exact: true }).click();
    expect(await host.intent('scene.activate', { sceneId: privateId })).toMatchObject({
      t: 'reject',
    });
    expect(await host.intent('scene.delete', { sceneId: active })).toMatchObject({ t: 'ack' });
    await expect(player.page.getByLabel('Current scene', { exact: true })).toHaveText('');
    await expect(player.page.getByRole('dialog')).toHaveCount(0);
    await expect(dm.getByLabel('Current scene', { exact: true })).toHaveText(
      'SECRET-PRIVATE-SCENE',
    );
    expect(await host.intent('scene.delete', { sceneId: privateId })).toMatchObject({
      t: 'reject',
    });
    await expect(secret.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled();
    const late = await openClient(browser, table, 'lifecycle-late', { joinScreen: true });
    const lateFrames = recordPageFrames(late.page);
    await late.page.getByLabel('Display name').fill('Late visitor');
    await late.page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(late.page.getByRole('alert')).toContainText('No active scene');
    await player.page.reload();
    await expect(player.page.getByRole('alert')).toContainText('No active scene');
    for (const received of [frames, lateFrames]) {
      expect(received.join('\n')).not.toContain(privateId);
      expect(received.join('\n')).not.toContain('SECRET-PRIVATE-SCENE');
      expect(received.join('\n')).not.toContain(privateEntity);
      expect(received.join('\n')).not.toContain('SECRET-PRIVATE-PROP');
    }
    expect(errors).toEqual([]);
    await player.context.close();
    await late.context.close();
  } finally {
    await Promise.all(clients.map((client) => client.close()));
    await dmContext.close();
    await table.stop();
  }
});
