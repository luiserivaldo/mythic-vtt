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
  await page.getByRole('button', { name: 'Initiative', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Rounds and initiative' });
  // UX-38: the list opens in the left pane beside the rail; the right dock has no segment for it.
  const pane = page.getByRole('complementary', { name: 'Left pane' });
  await expect(pane.getByRole('region', { name: 'Rounds and initiative' })).toBeVisible();
  await expect(
    page
      .getByRole('complementary', { name: 'Right dock' })
      .getByRole('region', { name: 'Rounds and initiative' }),
  ).toHaveCount(0);
  await pane.getByRole('button', { name: 'Collapse left pane' }).click();
  await expect(panel).toBeHidden();
  await pane.getByRole('button', { name: 'Expand left pane' }).click();
  await expect(panel).toBeVisible();
  const rows = panel.getByRole('listitem');
  const score = (name: string) => panel.getByLabel(`Initiative for ${name}`);
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
  await spectator.page.getByRole('button', { name: 'Initiative', exact: true }).click();
  const readonly = spectator.page.getByRole('region', { name: 'Rounds and initiative' });
  await expect(readonly.getByRole('listitem')).toHaveCount(1);
  // UX-38: a spectator gets the list with no control at all, enabled or otherwise.
  await expect(readonly.getByRole('button')).toHaveCount(0);
  await expect(readonly.getByRole('spinbutton')).toHaveCount(0);
  await expect(readonly.getByRole('combobox')).toHaveCount(0);
  await expect(readonly).not.toContainText('Secret combatant');
  await panel.getByRole('button', { name: 'Next turn' }).click();
  await expect(panel).toContainText('Round 2 · Turn 1');
  await expect(panel.getByLabel('Set round')).toHaveValue('2');
  await panel.getByLabel('Initiative token').selectOption(beast);
  await panel.getByRole('button', { name: 'Add to initiative' }).click();
  await expect(rows).toHaveCount(3);

  // Sort order: scores sort the rows highest first, numbered 1. 2. 3., unscored rows last.
  await score('Hero').fill('12');
  await score('Hero').press('Enter');
  await score('Secret combatant').fill('20');
  await score('Secret combatant').press('Enter');
  await expect(rows).toHaveText([/^1\.Secret combatant/, /^2\.Hero/, /^3\.Beast/]);
  await score('Beast').fill('15');
  await score('Beast').press('Enter');
  await expect(rows).toHaveText([/^1\.Secret combatant/, /^2\.Beast/, /^3\.Hero/]);
  await expect(panel).toContainText('Round 2 · Turn 3');
  // Live edit re-sort: raising a score moves the row, for the DM and for every viewer.
  await score('Hero').fill('30');
  await score('Hero').blur();
  await expect(rows).toHaveText([/^1\.Hero/, /^2\.Secret combatant/, /^3\.Beast/]);
  await expect(score('Hero')).toHaveValue('30');
  await expect(readonly.getByRole('listitem')).toHaveText([/^1\.Hero30$/, /^2\.Beast15$/]);
  await player.waitFor('public scores', () => initiative(player)?.values?.[hero] === 30);
  // PERM-03: the hidden combatant's score never reaches a player.
  expect(initiative(player)?.values).toEqual({ [hero]: 30, [beast]: 15 });
  await panel.getByRole('button', { name: 'Highest first' }).click();
  await expect(rows).toHaveText([/^1\.Beast/, /^2\.Secret combatant/, /^3\.Hero/]);
  await panel.getByRole('button', { name: 'Lowest first' }).click();
  await expect(rows).toHaveText([/^1\.Hero/, /^2\.Secret combatant/, /^3\.Beast/]);

  // Loop advance: the arrow keys step the turn around the list and wrap into the next round.
  await panel.getByRole('list', { name: 'Turn order' }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(panel).toContainText('Round 2 · Turn 2');
  await page.keyboard.press('ArrowDown');
  await expect(panel).toContainText('Round 2 · Turn 3');
  await page.keyboard.press('ArrowDown');
  await expect(panel).toContainText('Round 3 · Turn 1');
  await expect(rows.nth(0)).toHaveAttribute('aria-current', 'step');
  await page.keyboard.press('ArrowUp');
  await expect(panel).toContainText('Round 2 · Turn 3');
  await player.waitFor('public current turn', () => initiative(player)?.activeEntityId === beast);
  expect(initiative(player)?.order).toEqual([hero, beast]);
  expect(await player.intent('initiative.advance', { sceneId })).toMatchObject({ t: 'reject' });
  expect(initiative(player)?.activeEntityId).toBe(beast);
  // MV-171 / PERM-03: entity-only actions must also update the roster and current turn.
  for (const hidden of [true, false]) {
    expect(
      await host.intent('entity.setLayer', {
        sceneId,
        entityId: beast,
        layer: hidden ? 'dm' : 'tokens',
      }),
    ).toMatchObject({ t: 'ack' });
    await player.waitForSeq(host.lastSeq);
    expect(initiative(player)?.order).toEqual(hidden ? [hero] : [hero, beast]);
    expect(initiative(player)?.activeEntityId).toBe(hidden ? null : beast);
    await expect(readonly.getByRole('listitem')).toHaveCount(hidden ? 1 : 2);
  }
  expect(
    await host.intent('entity.setOwners', { sceneId, entityId: beast, owners: [] }),
  ).toMatchObject({ t: 'ack' });
  for (const hidden of [true, false]) {
    expect(
      await host.intent('permission.update', {
        sceneId,
        entityId: beast,
        target: 'entity',
        permissions: { view: !hidden },
      }),
    ).toMatchObject({ t: 'ack' });
    await player.waitForSeq(host.lastSeq);
    expect(initiative(player)?.order).toEqual(hidden ? [hero] : [hero, beast]);
    expect(initiative(player)?.activeEntityId).toBe(hidden ? null : beast);
    await expect(readonly.getByRole('listitem')).toHaveCount(hidden ? 1 : 2);
  }
  expect(player.frames.join('\n')).not.toMatch(new RegExp(`${secret}|Secret combatant`));
  await page.getByRole('button', { name: '3D view' }).click();
  await expect(page.getByRole('button', { name: 'Reset view' })).toBeVisible();
  await expect(panel.locator('li[aria-current="step"]')).toContainText('Beast');
  await page.reload();
  await page.getByRole('button', { name: 'Initiative', exact: true }).click();
  await expect(panel.getByRole('listitem')).toHaveCount(3);
  await expect(panel).toContainText('Round 2 · Turn 3');
  // The history endpoint must report the viewer's public position, not the host's index.
  expect(
    await host.intent('initiative.set', {
      sceneId,
      initiative: { round: 2, order: [secret, hero, beast], activeEntityId: beast },
    }),
  ).toMatchObject({ t: 'ack' });
  expect(
    await host.intent('token.move', {
      sceneId,
      entityId: beast,
      to: { x: 23, y: 0, z: 15 },
    }),
  ).toMatchObject({ t: 'ack' });
  const history = await fetch(
    `http://127.0.0.1:${String(table.hostPort)}/api/history?entityId=${beast}&limit=1`,
    {
      headers: {
        Authorization: `Mythic ${playerIdentity.identityId}.${playerIdentity.identitySecret}`,
      },
    },
  );
  expect(history.status).toBe(200);
  const body: unknown = await history.json();
  expect(body).toMatchObject({ entries: [{ type: 'token.move', round: 2, turn: 2 }] });
  expect(JSON.stringify(body)).not.toMatch(new RegExp(`${secret}|Secret combatant`));
  expect(
    await host.intent('initiative.set', {
      sceneId,
      initiative: { round: 2, order: [hero, beast, secret], activeEntityId: beast },
    }),
  ).toMatchObject({ t: 'ack' });
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
  await panel.getByRole('button', { name: 'Apply round' }).focus();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Initiative', exact: true })).toBeFocused();
  expect(errors).toEqual([]);
  await spectator.context.close();
  await context.close();
  await player.close();
  await host.close();
});
