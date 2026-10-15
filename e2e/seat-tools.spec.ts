import { expect, test } from '@playwright/test';
import { RawClient, startTable, testUlid, type Reply } from './harness.js';

const ok = async (promise: Promise<Reply>) => {
  expect(await promise).toMatchObject({ t: 'ack' });
};

// UI-SEAT-02 (UX-46, MV-251): each seat's own tools gate its ephemerals on the host. One seat's
// override never changes another, players cannot grant themselves tools, the retired scene-wide
// toggle is refused for everyone, and nothing hidden leaks.
test('seat tools gate player ephemerals per seat on the host; host unaffected; nothing leaks', async () => {
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
    await ok(host.intent('scene.create', { sceneId, name: 'Tools' }));
    await ok(host.intent('scene.activate', { sceneId }));
    await ok(
      host.intent('scene.create', { sceneId: secretSceneId, name: 'SECRET-SCENE', dmOnly: true }),
    );
    // The retired scene-wide toggle is refused, even for the host.
    expect(
      await host.intent('scene.setPlayerToggles', { sceneId, toggles: { measure: false } }),
    ).toMatchObject({ t: 'reject' });
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
    const rulerFrom = (frames: string[], from: string) =>
      frames.filter((f) => f.includes('ruler.preview') && f.includes(from)).length;

    // Measuring is on in the Player template; the DM turns it off for this seat only.
    player.ephemeral('ruler.preview', ruler);
    await watcher.waitFor('player ruler', () => rulerFrom(watcher.frames, opts.identityId) === 1);
    await ok(host.intent('seat.update', { seatId, tools: { measure: false } }));
    await player.waitForSeq(host.lastSeq);
    // A player can neither override their own seat nor use the retired toggle.
    expect(await player.intent('seat.update', { seatId, tools: { measure: true } })).toMatchObject({
      t: 'reject',
      reason: 'forbidden',
    });
    expect(
      await player.intent('scene.setPlayerToggles', { sceneId, toggles: { measure: true } }),
    ).toMatchObject({ t: 'reject' });
    player.ephemeral('ruler.preview', ruler);
    host.ephemeral('ruler.preview', ruler);
    await watcher.waitFor('host ruler', () => rulerFrom(watcher.frames, testUlid('HOST', 1)) === 1);
    expect(rulerFrom(watcher.frames, opts.identityId)).toBe(1);
    // The other seat keeps its own Measure: overriding one seat never changes another.
    watcher.ephemeral('ruler.preview', ruler);
    await player.waitFor(
      'watcher ruler',
      () => rulerFrom(player.frames, watchOpts.identityId) === 1,
    );

    // The seat-level switch still applies on top of a tool that is on.
    await ok(host.intent('seat.update', { seatId, tools: { measure: true } }));
    await ok(host.intent('seat.update', { seatId, interactionEnabled: false }));
    await player.waitForSeq(host.lastSeq);
    player.ephemeral('ruler.preview', ruler);
    host.ephemeral('ruler.preview', ruler);
    await watcher.waitFor(
      'second host ruler',
      () => rulerFrom(watcher.frames, testUlid('HOST', 1)) === 2,
    );
    expect(rulerFrom(watcher.frames, opts.identityId)).toBe(1);

    // The DM-only scene never reaches the player.
    expect(player.frames.join('\n')).not.toContain('SECRET-SCENE');
    expect(player.frames.join('\n')).not.toContain(secretSceneId);
  } finally {
    await Promise.all(clients.map((client) => client.close()));
    await table.stop();
  }
});
