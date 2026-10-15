import { expect, test } from '@playwright/test';
import { Campaign } from '../packages/shared/src/index.js';
import { RawClient, startTable, testUlid } from './harness.js';

test('initiative follows local DM browsing without changing the players scene', async ({
  browser,
}) => {
  const table = await startTable();
  const context = await browser.newContext();
  const identity = { identityId: testUlid('HOST', 171), identitySecret: 'initiative-browse-host' };
  const host = await RawClient.connect(table, {
    name: 'DM',
    ...identity,
    hostToken: table.hostToken,
  });
  const player = await RawClient.connect(table, {
    name: 'Viewer',
    identityId: testUlid('PLAYER', 171),
    identitySecret: 'initiative-browse-viewer',
  });
  try {
    const publicId = testUlid('SCENE', 171),
      privateId = testUlid('PRIVATE', 171);
    expect(
      await host.intent('scene.create', { sceneId: publicId, name: 'Public initiative' }),
    ).toMatchObject({ t: 'ack' });
    expect(await host.intent('scene.activate', { sceneId: publicId })).toMatchObject({ t: 'ack' });
    expect(
      await host.intent('scene.create', {
        sceneId: privateId,
        name: 'Private initiative',
        dmOnly: true,
      }),
    ).toMatchObject({ t: 'ack' });
    for (const [sceneId, round] of [
      [publicId, 2],
      [privateId, 7],
    ] as const)
      expect(
        await host.intent('initiative.set', {
          sceneId,
          initiative: { round, order: [], activeEntityId: null },
        }),
      ).toMatchObject({ t: 'ack' });
    await context.addInitScript((saved) => {
      localStorage.setItem('mythic.identity.v1', JSON.stringify(saved));
      localStorage.setItem('mythic.host', '1');
    }, identity);
    const page = await context.newPage();
    await page.goto(table.clientUrl);
    await expect(page.getByRole('status')).toHaveText('Connected to New campaign');
    await page.getByRole('button', { name: 'Initiative', exact: true }).click();
    const panel = page
      .getByRole('complementary', { name: 'Left pane' })
      .getByRole('region', { name: 'Rounds and initiative' });
    await expect(panel).toContainText('Round 2');
    await page.getByRole('tab', { name: 'Scenes', exact: true }).click();
    await page.getByRole('button', { name: 'View Private initiative', exact: true }).click();
    await expect(panel.getByLabel('Set round')).toHaveValue('7');
    await panel.getByLabel('Set round').fill('8');
    await panel.getByRole('button', { name: 'Apply round' }).click();
    await host.waitFor(
      'private round update',
      () => Campaign.parse(host.state).scenes[privateId]?.initiative?.round === 8,
    );
    await player.waitForSeq(host.lastSeq);
    const state = Campaign.parse(player.state);
    expect(state.activeSceneId).toBe(publicId);
    expect(state.scenes[publicId]?.initiative?.round).toBe(2);
    expect(player.frames.join('\n')).not.toMatch(new RegExp(`${privateId}|Private initiative`));
  } finally {
    await context.close();
    await player.close();
    await host.close();
    await table.stop();
  }
});
