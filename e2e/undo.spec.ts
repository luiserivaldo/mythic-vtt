import { expect, test } from '@playwright/test';
import { RawClient, startTable, testUlid, type Reply, type Table } from './harness.js';

// M4-30 (HIST-04): Ctrl+Z undoes the viewer's own last action; the DM can pick entries in the
// History log (multi-select, right-click -> Undo). Undo is a logged action, and undoing a DM-layer
// action tells players and spectators nothing.

let table: Table;
test.beforeAll(async () => {
  table = await startTable();
});
test.afterAll(async () => {
  await table.stop();
});

interface Snapshot {
  scenes: Record<string, { entities: Record<string, { transform: { position: { x: number } } }> }>;
}

test('Ctrl+Z, History multi-select undo, and no leak of an undone DM-layer action', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const identity = { identityId: testUlid('HOST', 71), identitySecret: 'undo-test-host' };
  const sceneId = testUlid('SCENE', 71);
  const seatId = testUlid('SEAT', 71);
  const tokenId = testUlid('TOKEN', 71);
  const secretId = testUlid('SECRET', 71);

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
  await ack(host.intent('scene.create', { sceneId, name: 'Undo scene' }));
  await ack(host.intent('scene.activate', { sceneId }));
  await ack(host.intent('seat.create', { seatId, label: 'Aria' }));
  const transform = (x: number) => ({
    position: { x, y: 0, z: 5 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  });
  const token = { sizeCells: 1, heightCells: 1, labelVisibility: 'all' };
  await ack(
    host.intent('entity.create', {
      sceneId,
      entity: {
        id: tokenId,
        name: 'Aria token',
        layer: 'tokens',
        owners: [seatId],
        transform: transform(1),
        token,
      },
    }),
  );
  await ack(
    host.intent('entity.create', {
      sceneId,
      entity: {
        id: secretId,
        name: 'SECRET-UNDO',
        layer: 'dm',
        owners: [],
        transform: transform(1),
        token,
      },
    }),
  );

  const player = await RawClient.connect(table, {
    name: 'Aria',
    identityId: testUlid('PLAYER', 71),
    identitySecret: 'undo-test-player',
  });
  await player.waitFor('snapshot', () => player.state !== undefined);
  player.join(seatId);
  await player.waitFor('seated', () => JSON.stringify(player.state).includes(tokenId));
  const spectator = await RawClient.connect(table, {
    name: 'Watcher',
    identityId: testUlid('WATCH', 71),
    identitySecret: 'undo-test-watch',
  });
  await spectator.waitFor('snapshot', () => spectator.state !== undefined);

  const x = (client: RawClient, id: string) =>
    (client.state as Snapshot).scenes[sceneId]?.entities[id]?.transform.position.x;
  const move = (client: RawClient, id: string, to: number) =>
    ack(client.intent('token.move', { sceneId, entityId: id, to: { x: to, y: 0, z: 5 } }));

  const firstMove = await move(player, tokenId, 2);
  const secondMove = await move(player, tokenId, 3);
  await move(host, secretId, 9);
  await move(host, secretId, 10);

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

  // 1. Ctrl+Z reverts the DM's own last action only (the secret token's second move).
  await page
    .locator('canvas')
    .first()
    .click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect.poll(() => x(host, secretId), { timeout: 10_000 }).toBe(9);
  expect(x(host, tokenId)).toBe(3); // the player's token is untouched

  // 2. Nothing about the DM-layer undo reached the player or the spectator.
  await host.waitForSeq(host.lastSeq);
  for (const client of [player, spectator]) {
    await client.waitForSeq(host.lastSeq);
    const wire = client.frames.join('\n');
    expect(wire).not.toContain(secretId);
    expect(wire).not.toContain('SECRET-UNDO');
  }

  // 3. The DM selects both of the player's moves in History and undoes them from the menu.
  await page.getByRole('button', { name: 'History', exact: true }).click();
  const history = page.getByRole('region', { name: 'Action history' });
  await expect(history.getByText(`#${String(secondMove)} token.move`)).toBeVisible();
  await history.getByLabel(`Select action #${String(firstMove)}`).click();
  await history.getByLabel(`Select action #${String(secondMove)}`).click({ modifiers: ['Shift'] });
  await expect(history.getByRole('button', { name: /Undo selected \(2\)/ })).toBeEnabled();
  await history.getByText(`#${String(secondMove)} token.move`).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Undo 2 actions' }).click();
  await expect.poll(() => x(host, tokenId), { timeout: 10_000 }).toBe(1);
  await expect.poll(() => x(player, tokenId), { timeout: 10_000 }).toBe(1);
  await expect.poll(() => x(spectator, tokenId), { timeout: 10_000 }).toBe(1);

  // 4. Already undone: the same entries cannot be undone twice, and the log keeps them.
  const again = await host.intent('history.undo', { targetSeqs: [firstMove] });
  expect(again).toMatchObject({ t: 'reject', reason: 'forbidden' });
  await history.getByRole('button', { name: 'Refresh history' }).click();
  await expect(history.getByText('history.undo').first()).toBeVisible();
  await expect(history.getByText(`#${String(firstMove)} token.move`)).toBeVisible();

  expect(errors).toEqual([]);
  await Promise.all([spectator.close(), player.close(), host.close()]);
  await context.close();
});
