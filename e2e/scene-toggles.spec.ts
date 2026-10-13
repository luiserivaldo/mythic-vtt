import { expect, test } from '@playwright/test';
import { RawClient, startTable, testUlid, type Reply } from './harness.js';

const ok = async (promise: Promise<Reply>) => {
  expect(await promise).toMatchObject({ t: 'ack' });
};

test('scene toggles gate player ephemerals and intents; host unaffected; nothing hidden leaks', async () => {
  const table = await startTable();
  const clients: RawClient[] = [];
  try {
    const sceneId = testUlid('SCENE', 1);
    const secretSceneId = testUlid('SCENE', 2);
    const seatId = testUlid('SEAT', 1);
    const host = await RawClient.connect(table, {
      name: 'host',
      identityId: testUlid('HOST', 1),
      identitySecret: 'test-host',
      hostToken: table.hostToken,
    });
    clients.push(host);
    await host.waitFor('snapshot', () => host.state !== undefined);
    await ok(host.intent('scene.create', { sceneId, name: 'Toggles' }));
    await ok(host.intent('scene.activate', { sceneId }));
    await ok(
      host.intent('scene.create', { sceneId: secretSceneId, name: 'SECRET-SCENE', dmOnly: true }),
    );
    await ok(
      host.intent('scene.setPlayerToggles', { sceneId: secretSceneId, toggles: { draw: true } }),
    );
    await ok(host.intent('seat.create', { seatId, label: 'Player' }));

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

    const watchSeatId = testUlid('SEAT', 2);
    await ok(host.intent('seat.create', { seatId: watchSeatId, label: 'Watcher' }));
    const watchOpts = {
      name: 'watcher',
      identityId: testUlid('WATCH', 1),
      identitySecret: 'test-watch',
    };
    const watcher = await RawClient.connect(table, watchOpts);
    clients.push(watcher);
    await watcher.waitFor('snapshot', () => watcher.state !== undefined);
    watcher.join(watchSeatId);
    await watcher.waitFor('seat joined', () =>
      JSON.stringify(watcher.state).includes(watchOpts.identityId),
    );

    const ruler = { sceneId, points: [{ x: 0, y: 0, z: 0 }], phase: 'active' };
    const rulerFrom = (from: string) =>
      watcher.frames.filter((f) => f.includes('ruler.preview') && f.includes(from)).length;

    // Measuring is open by default; the DM closes it.
    player.ephemeral('ruler.preview', ruler);
    await watcher.waitFor('player ruler', () => rulerFrom(opts.identityId) === 1);
    await ok(host.intent('scene.setPlayerToggles', { sceneId, toggles: { measure: false } }));
    await player.waitForSeq(host.lastSeq);
    expect(
      await player.intent('scene.setPlayerToggles', { sceneId, toggles: { measure: true } }),
    ).toMatchObject({
      t: 'reject',
      reason: 'forbidden',
    });
    player.ephemeral('ruler.preview', ruler);
    host.ephemeral('ruler.preview', ruler);
    await watcher.waitFor('host ruler', () => rulerFrom(testUlid('HOST', 1)) === 1);
    expect(rulerFrom(opts.identityId)).toBe(1);

    // The seat-level switch still applies on top of an enabled scene toggle.
    await ok(host.intent('scene.setPlayerToggles', { sceneId, toggles: { measure: true } }));
    await ok(host.intent('seat.update', { seatId, interactionEnabled: false }));
    await player.waitForSeq(host.lastSeq);
    player.ephemeral('ruler.preview', ruler);
    host.ephemeral('ruler.preview', ruler);
    await watcher.waitFor('second host ruler', () => rulerFrom(testUlid('HOST', 1)) === 2);
    expect(rulerFrom(opts.identityId)).toBe(1);

    // The DM-only scene (and its toggles) never reaches the player.
    expect(player.frames.join('\n')).not.toContain('SECRET-SCENE');
    expect(player.frames.join('\n')).not.toContain(secretSceneId);
  } finally {
    await Promise.all(clients.map((client) => client.close()));
    await table.stop();
  }
});
