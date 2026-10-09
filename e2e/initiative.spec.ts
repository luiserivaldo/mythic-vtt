import { expect, test } from '@playwright/test';
import { Campaign } from '../packages/shared/src/index.js';
import { RawClient, openClient, startTable, testUlid, type Table } from './harness.js';

let table: Table;
test.beforeAll(async () => {
  table = await startTable();
});
test.afterAll(async () => {
  await table.stop();
});

test('DM initiative syncs in both views, persists and excludes private combatants', async ({
  browser,
}) => {
  const identity = { identityId: testUlid('HOST', 1), identitySecret: 'initiative-host' };
  const playerIdentity = { identityId: testUlid('PLAYER', 1), identitySecret: 'initiative-player' };
  const host = await RawClient.connect(table, {
    name: 'DM',
    ...identity,
    hostToken: table.hostToken,
  });
  const sceneId = testUlid('SCENE', 1);
  const seatId = testUlid('SEAT', 1);
  const hero = testUlid('TOKEN', 1);
  const beast = testUlid('TOKEN', 2);
  const secret = testUlid('TOKEN', 3);
  expect(await host.intent('scene.create', { sceneId, name: 'Initiative' })).toMatchObject({
    t: 'ack',
  });
  expect(await host.intent('scene.activate', { sceneId })).toMatchObject({ t: 'ack' });
  expect(await host.intent('seat.create', { seatId, label: 'Player' })).toMatchObject({ t: 'ack' });
  expect(
    await host.intent('seat.assign', { seatId, identityId: playerIdentity.identityId }),
  ).toMatchObject({ t: 'ack' });
  for (const [id, name, layer] of [
    [hero, 'Hero', 'tokens'],
    [beast, 'Beast', 'tokens'],
    [secret, 'Secret combatant', 'dm'],
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
            position: { x: id === hero ? 18 : 22, y: 0, z: 15 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
          },
          token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
        },
      }),
    ).toMatchObject({ t: 'ack' });
  }
  const player = await RawClient.connect(table, { name: 'Player', ...playerIdentity });
  await player.waitFor('player snapshot', () => player.state !== undefined);
  const initiative = (client: RawClient) =>
    Campaign.safeParse(client.state).data?.scenes[sceneId]?.initiative;
  const context = await browser.newContext();
  await context.addInitScript((value) => {
    localStorage.setItem('mythic.identity.v1', JSON.stringify(value));
    localStorage.setItem('mythic.host', '1');
  }, identity);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(table.clientUrl);
  await page.getByRole('button', { name: 'Rounds', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Rounds and initiative' });
  for (const id of [hero, secret]) {
    await panel.getByLabel('Initiative token').selectOption(id);
    await panel.getByRole('button', { name: 'Add to initiative' }).click();
    await expect(panel.getByRole('listitem')).toHaveCount(id === hero ? 1 : 2);
  }
  await player.waitFor('public roster', () => initiative(player)?.order.length === 1);
  expect(initiative(player)?.order).toEqual([hero]);
  await panel.getByRole('button', { name: 'Next turn' }).click();
  await host.waitFor('private turn', () => initiative(host)?.activeEntityId === secret);
  await player.waitForSeq(host.lastSeq);
  expect(initiative(player)?.activeEntityId).toBeNull();
  const spectator = await openClient(browser, table, 'spectator');
  await spectator.page.getByRole('button', { name: 'Rounds', exact: true }).click();
  const readonly = spectator.page.getByRole('region', { name: 'Rounds and initiative' });
  await expect(readonly.getByRole('listitem')).toHaveCount(1);
  await expect(readonly.getByRole('button', { name: 'Next turn' })).toHaveCount(0);
  await expect(readonly).not.toContainText('Secret combatant');
  await panel.getByRole('button', { name: 'Next turn' }).click();
  await expect(panel).toContainText('Round 2 · Turn 1');
  await panel.getByLabel('Initiative token').selectOption(beast);
  await panel.getByRole('button', { name: 'Add to initiative' }).click();
  await expect(panel.getByRole('listitem')).toHaveCount(3);
  await panel.getByRole('button', { name: 'Earlier 3', exact: true }).click();
  await panel.getByRole('button', { name: 'Current turn 2', exact: true }).click();
  await player.waitFor('public current turn', () => initiative(player)?.activeEntityId === beast);
  expect(initiative(player)?.order).toEqual([hero, beast]);
  expect(await player.intent('initiative.advance', { sceneId })).toMatchObject({ t: 'reject' });
  expect(initiative(player)?.activeEntityId).toBe(beast);
  expect(player.frames.join('\n')).not.toMatch(new RegExp(`${secret}|Secret combatant`));
  await page.getByRole('button', { name: '3D view' }).click();
  await expect(page.getByRole('button', { name: 'Reset view' })).toBeVisible();
  await expect(panel).toContainText('Beast (current)');
  await page.reload();
  await page.getByRole('button', { name: 'Rounds', exact: true }).click();
  await expect(panel.getByRole('listitem')).toHaveCount(3);
  await expect(panel).toContainText('Round 2 · Turn 2');
  expect(await host.intent('entity.delete', { sceneId, entityId: beast })).toMatchObject({
    t: 'ack',
  });
  await expect(panel.getByRole('listitem')).toHaveCount(2);
  await player.waitForSeq(host.lastSeq);
  expect(initiative(player)?.order).toEqual([hero]);
  expect(initiative(player)?.activeEntityId).toBeNull();
  await panel.getByLabel('Set round').fill('4');
  await panel.getByRole('button', { name: 'Apply round' }).click();
  await expect(readonly).toContainText('Round 4');
  await panel.getByRole('button', { name: 'Reset encounter' }).click();
  await expect(readonly.getByRole('listitem')).toHaveCount(0);
  expect(errors).toEqual([]);
  await spectator.context.close();
  await context.close();
  await player.close();
  await host.close();
});
