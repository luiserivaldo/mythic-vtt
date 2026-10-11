import { expect, test } from '@playwright/test';
import { RawClient, startTable, testUlid, type Reply } from './harness.js';

const ok = async (promise: Promise<Reply>) => {
  expect(await promise).toMatchObject({ t: 'ack' });
};

test('disabled seats keep their view on reconnect but cannot act until the host re-enables them', async () => {
  const table = await startTable();
  const clients: RawClient[] = [];
  try {
    const sceneId = testUlid('SCENE', 1);
    const seatId = testUlid('SEAT', 1);
    const entityId = testUlid('TOKEN', 1);
    const secretId = testUlid('SECRET', 1);
    const host = await RawClient.connect(table, {
      name: 'host',
      identityId: testUlid('HOST', 1),
      identitySecret: 'test-host',
      hostToken: table.hostToken,
    });
    clients.push(host);
    await host.waitFor('snapshot', () => host.state !== undefined);
    await ok(host.intent('scene.create', { sceneId, name: 'Interaction' }));
    await ok(host.intent('scene.activate', { sceneId }));
    await ok(host.intent('seat.create', { seatId, label: 'Player' }));
    const transform = {
      position: { x: 1, y: 0, z: 1 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    };
    await ok(
      host.intent('entity.create', {
        sceneId,
        entity: {
          id: entityId,
          name: 'Visible',
          layer: 'tokens',
          owners: [seatId],
          transform,
          token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
        },
      }),
    );
    await ok(
      host.intent('entity.create', {
        sceneId,
        entity: { id: secretId, name: 'SECRET-INTERACTION', layer: 'dm', owners: [], transform },
      }),
    );
    const opts = {
      name: 'player',
      identityId: testUlid('PLAYER', 1),
      identitySecret: 'test-player',
    };
    const player = await RawClient.connect(table, opts);
    clients.push(player);
    await player.waitFor('snapshot', () => player.state !== undefined);
    player.join(seatId);
    await player.waitFor('seat joined', () =>
      JSON.stringify(player.state).includes(opts.identityId),
    );
    const move = { sceneId, entityId, to: { x: 2, y: 0, z: 2 } };
    await ok(player.intent('token.move', move));
    await ok(host.intent('seat.update', { seatId, interactionEnabled: false }));
    await player.waitForSeq(host.lastSeq);
    expect(await player.intent('token.move', move)).toMatchObject({
      t: 'reject',
      reason: 'forbidden',
    });
    expect(JSON.stringify(player.state)).toContain('Visible');
    await player.close();
    const reconnected = await RawClient.connect(table, opts);
    clients.push(reconnected);
    await reconnected.waitFor('snapshot', () => reconnected.state !== undefined);
    expect(await reconnected.intent('token.move', move)).toMatchObject({
      t: 'reject',
      reason: 'forbidden',
    });
    await ok(host.intent('seat.update', { seatId, interactionEnabled: true }));
    await reconnected.waitForSeq(host.lastSeq);
    await ok(reconnected.intent('token.move', move));
    for (const client of [player, reconnected]) {
      expect(client.frames.join('\n')).not.toContain(secretId);
      expect(client.frames.join('\n')).not.toContain('SECRET-INTERACTION');
    }
  } finally {
    await Promise.all(clients.map((client) => client.close()));
    await table.stop();
  }
});
