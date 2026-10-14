import { expect, test } from '@playwright/test';
import { RawClient, startTable, testUlid, type Reply, type Table } from './harness.js';

// M4-31 (HIST-07): the DM returns the table to an earlier point. The rollback is a logged action,
// every board resyncs, seats stay seated, nothing is erased (a later rollback can come back), and
// players and spectators never receive anything hidden while it happens.

let table: Table;
test.beforeAll(async () => {
  table = await startTable();
});
test.afterAll(async () => {
  await table.stop();
});

interface Snapshot {
  scenes: Record<
    string,
    { entities: Record<string, { name: string; transform: { position: { x: number } } }> }
  >;
  seats: Record<string, { label: string }>;
}

test('the DM rolls back, boards resync without leaks, and a later rollback restores the future', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const identity = { identityId: testUlid('HOST', 81), identitySecret: 'rollback-test-host' };
  const sceneId = testUlid('SCENE', 81);
  const seatId = testUlid('SEAT', 81);
  const lateSeatId = testUlid('SEAT', 82);
  const tokenId = testUlid('TOKEN', 81);
  const secretId = testUlid('SECRET', 81);
  const lateSecretId = testUlid('SECRET', 82);
  const lateTokenId = testUlid('TOKEN', 82);

  const host = await RawClient.connect(table, {
    name: 'DM',
    ...identity,
    hostToken: table.hostToken,
  });
  const ack = async (reply: Promise<Reply>): Promise<number> => {
    const r = await reply;
    expect(r.t).toBe('ack');
    return r.seq ?? -1;
  };
  const transform = (x: number) => ({
    position: { x, y: 0, z: 5 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  });
  const token = { sizeCells: 1, heightCells: 1, labelVisibility: 'all' };
  const create = (id: string, name: string, layer: 'tokens' | 'dm', owners: string[] = []) =>
    ack(
      host.intent('entity.create', {
        sceneId,
        entity: { id, name, layer, owners, transform: transform(1), token },
      }),
    );
  await ack(host.intent('scene.create', { sceneId, name: 'Rollback scene' }));
  await ack(host.intent('scene.activate', { sceneId }));
  await ack(host.intent('seat.create', { seatId, label: 'Aria' }));
  await create(tokenId, 'Aria token', 'tokens', [seatId]);
  await create(secretId, 'SECRET-ROLL', 'dm');

  const player = await RawClient.connect(table, {
    name: 'Aria',
    identityId: testUlid('PLAYER', 81),
    identitySecret: 'rollback-test-player',
  });
  await player.waitFor('snapshot', () => player.state !== undefined);
  player.join(seatId);
  await player.waitFor('seated', () => JSON.stringify(player.state).includes(tokenId));
  const spectator = await RawClient.connect(table, {
    name: 'Watcher',
    identityId: testUlid('WATCH', 81),
    identitySecret: 'rollback-test-watch',
  });
  await spectator.waitFor('snapshot', () => spectator.state !== undefined);

  const entity = (client: RawClient, id: string) =>
    (client.state as Snapshot).scenes[sceneId]?.entities[id];
  const x = (client: RawClient, id: string) => entity(client, id)?.transform.position.x;
  const move = (client: RawClient, id: string, to: number) =>
    ack(client.intent('token.move', { sceneId, entityId: id, to: { x: to, y: 0, z: 5 } }));

  // The point to return to: the token stands at x = 2.
  const point = await move(player, tokenId, 2);

  // The future that will be rolled back.
  const firstLate = await move(player, tokenId, 3);
  const lastLate = await move(player, tokenId, 4);
  await create(lateTokenId, 'Late token', 'tokens');
  await create(lateSecretId, 'LATE-SECRET', 'dm');
  await move(host, secretId, 9);
  const lastAction = await ack(
    host.intent('seat.create', { seatId: lateSeatId, label: 'Late seat' }),
  );
  expect(firstLate).toBeGreaterThan(point);
  await host.waitForSeq(host.lastSeq);
  await expect.poll(() => entity(player, lateTokenId)?.name).toBe('Late token');

  const context = await browser.newContext();
  await context.addInitScript((value) => {
    localStorage.setItem('mythic.identity.v1', JSON.stringify(value));
    localStorage.setItem('mythic.host', '1');
  }, identity);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(table.clientUrl);
  await expect(page.getByRole('status')).toHaveText('Connected to New campaign');

  // Only the DM may roll back.
  expect(await player.intent('history.rollback', { toSeq: point })).toMatchObject({
    t: 'reject',
    reason: 'forbidden',
  });
  expect(await spectator.intent('history.rollback', { toSeq: point })).toMatchObject({
    t: 'reject',
    reason: 'forbidden',
  });
  expect(x(host, tokenId)).toBe(4);

  // The DM rolls back: one logged action, and every board follows.
  const rolledBack = await ack(host.intent('history.rollback', { toSeq: point }));
  expect(rolledBack).toBeGreaterThan(lastAction);
  for (const client of [host, player, spectator]) {
    await client.waitForSeq(rolledBack);
    expect(x(client, tokenId)).toBe(2);
    expect(entity(client, lateTokenId)).toBeUndefined();
  }
  expect(entity(host, lateSecretId)).toBeUndefined();
  expect(x(host, secretId)).toBe(1);
  // People are not rolled back: the seat made after the point is still there.
  expect((host.state as Snapshot).seats[lateSeatId]?.label).toBe('Late seat');

  // Nothing hidden reached the player or the spectator, before or during the rollback.
  for (const client of [player, spectator]) {
    const wire = client.frames.join('\n');
    for (const secret of [secretId, lateSecretId, 'SECRET-ROLL', 'LATE-SECRET'])
      expect(wire).not.toContain(secret);
  }
  const response = await fetch(`${table.clientUrl}/api/history`, {
    headers: { Authorization: `Mythic ${testUlid('WATCH', 81)}.rollback-test-watch` },
  });
  expect(response.status).toBe(200);
  const body = await response.text();
  for (const secret of [secretId, lateSecretId, 'SECRET-ROLL', 'LATE-SECRET'])
    expect(body).not.toContain(secret);

  // The DM's board shows it in History; the log kept the undone future, so a rollback over this
  // rollback brings it back.
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  const history = page.getByRole('region', { name: 'Action history' });
  await expect(history.getByText(`#${String(rolledBack)} history.rollback`)).toBeVisible();
  await expect(history.getByText(`#${String(lastLate)} token.move`)).toBeVisible();
  await expect(history.getByText(`#${String(lastAction)} seat.create`)).toBeVisible();
  await history
    .getByRole('button', { name: `Roll back to #${String(lastAction)}`, exact: true })
    .click();
  await history
    .getByRole('button', { name: `Confirm roll back to #${String(lastAction)}`, exact: true })
    .click();
  await expect.poll(() => x(host, tokenId), { timeout: 10_000 }).toBe(4);
  await expect.poll(() => x(player, tokenId), { timeout: 10_000 }).toBe(4);
  await expect.poll(() => x(spectator, tokenId), { timeout: 10_000 }).toBe(4);
  expect(entity(player, lateTokenId)?.name).toBe('Late token');
  expect(entity(host, lateSecretId)?.name).toBe('LATE-SECRET');
  expect(entity(player, lateSecretId)).toBeUndefined();
  expect(entity(spectator, lateSecretId)).toBeUndefined();

  expect(errors).toEqual([]);
  await Promise.all([spectator.close(), player.close(), host.close()]);
  await context.close();
});
