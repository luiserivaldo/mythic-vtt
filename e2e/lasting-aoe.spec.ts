import { expect, test } from '@playwright/test';
import { Campaign } from '../packages/shared/src/index.js';
import { RawClient, startTable, testUlid } from './harness.js';

test('a player keeps a lasting AoE across replacement, modes and reload, with host-controlled caps', async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const table = await startTable();
  const dmContext = await browser.newContext(),
    playerContext = await browser.newContext();
  const hostIdentity = { identityId: testUlid('HOST', 180), identitySecret: 'lasting-host' };
  const playerIdentity = { identityId: testUlid('PLAYER', 180), identitySecret: 'lasting-player' };
  const host = await RawClient.connect(table, {
    name: 'DM',
    ...hostIdentity,
    hostToken: table.hostToken,
  });
  const seatId = testUlid('SEAT', 180),
    sceneId = testUlid('SCENE', 180);
  let player: RawClient | undefined;
  let observer: RawClient | undefined;
  let replay: RawClient | undefined;
  try {
    expect(
      await host.intent('scene.create', { sceneId, name: 'Lasting spell board' }),
    ).toMatchObject({ t: 'ack' });
    expect(await host.intent('scene.activate', { sceneId })).toMatchObject({ t: 'ack' });
    expect(await host.intent('seat.create', { seatId, label: 'Caster' })).toMatchObject({
      t: 'ack',
    });
    expect(
      await host.intent('seat.assign', { seatId, identityId: playerIdentity.identityId }),
    ).toMatchObject({ t: 'ack' });
    player = await RawClient.connect(table, { name: 'Caster', ...playerIdentity });
    const observerIdentity = {
      identityId: testUlid('OBSERVER', 180),
      identitySecret: 'lasting-observer',
    };
    const observerSeat = testUlid('SECONDSEAT', 180);
    expect(
      await host.intent('seat.create', { seatId: observerSeat, label: 'Observer' }),
    ).toMatchObject({ t: 'ack' });
    expect(
      await host.intent('seat.assign', {
        seatId: observerSeat,
        identityId: observerIdentity.identityId,
      }),
    ).toMatchObject({ t: 'ack' });
    observer = await RawClient.connect(table, { name: 'Observer', ...observerIdentity });
    await observer.waitForSeq(host.lastSeq);
    const observerBefore = observer.state,
      observerSeq = observer.lastSeq;

    for (const [context, identity, hostFlag] of [
      [dmContext, hostIdentity, true],
      [playerContext, playerIdentity, false],
    ] as const)
      await context.addInitScript(
        ({ identity, hostFlag }) => {
          localStorage.setItem('mythic.identity.v1', JSON.stringify(identity));
          localStorage.setItem(
            'mythic.profile.v1',
            JSON.stringify({ displayName: hostFlag ? 'DM' : 'Caster' }),
          );
          if (hostFlag) localStorage.setItem('mythic.host', '1');
        },
        { identity, hostFlag },
      );
    const errors: string[] = [];
    const dm = await dmContext.newPage(),
      page = await playerContext.newPage();
    page.on('pageerror', (error) => {
      errors.push(error.message);
    });
    await Promise.all([dm.goto(table.clientUrl), page.goto(table.clientUrl)]);
    await expect(page.getByRole('status')).toHaveText('Connected to New campaign');
    await expect(dm.getByRole('status')).toHaveText('Connected to New campaign');
    await page.getByRole('button', { name: 'Measure', exact: true }).click();
    await page.getByText('Measurement shapes', { exact: true }).click();
    await page.getByLabel('Measurement shape').selectOption('sphere');
    const tool = page.getByRole('region', { name: 'AoE tool' });
    const scene = () => Campaign.parse(host.state).scenes[sceneId];
    const lasting = () =>
      Object.values(scene()?.entities ?? {}).filter((entity) => entity.lastingAoE);
    const plot = async (dx = 0) => {
      const box = await page.locator('canvas').boundingBox();
      if (!box) throw new Error('canvas missing');
      await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2);
      await expect
        .poll(() => scene()?.entities[playerIdentity.identityId]?.aoe?.kind)
        .toBe('sphere');
    };
    await plot();
    await tool.getByRole('button', { name: 'Place AoE', exact: true }).click();
    await expect.poll(() => lasting().length).toBe(1);
    const first = lasting()[0];
    if (!first) throw new Error('lasting spell missing');
    expect(first.owners).toEqual([seatId]);
    await observer.waitForSeq(host.lastSeq);
    expect(Campaign.parse(observer.state).scenes[sceneId]?.entities[first.id]?.lastingAoE).toEqual(
      {},
    );
    expect(observer.frames.join('')).not.toContain('creatorIdentityId');
    replay = await RawClient.connect(table, {
      name: 'Observer replay',
      ...observerIdentity,
      lastSeq: observerSeq,
      initialState: observerBefore,
    });
    await replay.waitForSeq(host.lastSeq);
    expect(replay.frames.join('')).not.toContain('creatorIdentityId');
    expect(Campaign.parse(replay.state).scenes[sceneId]?.entities[first.id]?.lastingAoE).toEqual(
      {},
    );

    expect(scene()?.entities[playerIdentity.identityId]).toBeUndefined();
    await plot(60);
    await expect(tool.getByRole('button', { name: 'Place AoE', exact: true })).toBeDisabled();
    expect(lasting().map((entity) => entity.id)).toEqual([first.id]);
    await page.locator('canvas').screenshot({ path: '/tmp/mythic-mv180-lasting-2d.png' });
    await page.getByRole('button', { name: '3D view' }).click();
    await expect(page.getByRole('button', { name: 'Reset view' })).toBeVisible();
    await page.locator('canvas').screenshot({ path: '/tmp/mythic-mv180-lasting-3d.png' });
    await page.reload();
    await expect(page.getByRole('status')).toHaveText('Connected to New campaign');
    await player.waitForSeq(host.lastSeq);
    expect(Campaign.parse(player.state).scenes[sceneId]?.entities[first.id]?.lastingAoE).toEqual({
      creatorIdentityId: playerIdentity.identityId,
    });
    await dm.getByRole('button', { name: 'Measure', exact: true }).click();
    await dm.getByLabel('Lasting AoE limit per player').fill('2');
    await dm.getByRole('button', { name: 'Apply AoE limit' }).click();
    await expect.poll(() => scene()?.maxLastingAoEsPerPlayer).toBe(2);
    await page.getByRole('button', { name: 'Measure', exact: true }).click();
    await page.getByText('Measurement shapes', { exact: true }).click();
    await page.getByLabel('Measurement shape').selectOption('sphere');
    await tool.getByRole('button', { name: 'Place AoE', exact: true }).click();
    await expect.poll(() => lasting().length).toBe(2);
    expect(await host.intent('aoe.remove', { sceneId, entityId: first.id })).toMatchObject({
      t: 'ack',
    });
    await expect.poll(() => lasting().length).toBe(1);
    expect(await host.intent('seat.update', { seatId, interactionEnabled: false })).toMatchObject({
      t: 'ack',
    });
    await player.waitForSeq(host.lastSeq);
    expect(
      await player.intent('aoe.persist', {
        sceneId,
        sourceId: playerIdentity.identityId,
        entityId: testUlid('BLOCKED', 180),
      }),
    ).toMatchObject({ t: 'reject' });
    expect(lasting()).toHaveLength(1);
    expect(errors).toEqual([]);
  } finally {
    await playerContext.close();
    await dmContext.close();
    await replay?.close();
    await observer?.close();
    await player?.close();
    await host.close();
    await table.stop();
  }
});
