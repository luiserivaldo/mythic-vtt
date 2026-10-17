import { expect, test } from '@playwright/test';
import { RawClient, startTable, testUlid, type Reply } from './harness.js';

// MV-232 / PERM-03: every scene-scoped ephemeral passes one host-side scene gate. A DM measuring
// or drawing on a DM-only prep scene must never hand that scene's id or coordinates to a player or
// a spectator, while a co-DM — who may see the scene (D32) — still gets the frame. Pings have their
// own spec (`pings.spec.ts`); this one covers the ruler preview the leak was first reported on, a
// drawing stroke and a cursor, at the transport level. MV-282: the relay fans out only the channels
// it knows, and a cursor must name its scene, so neither can slip past the gate.

const ok = async (promise: Promise<Reply>) => {
  expect(await promise).toMatchObject({ t: 'ack' });
};

const framesOn = (frames: string[], channel: string, from: string) =>
  frames.filter((raw) => raw.includes(`"channel":"${channel}"`) && raw.includes(from)).length;

test('a ruler, a stroke or a cursor on a DM-only scene reaches the co-DM, never a player or spectator', async () => {
  test.setTimeout(60_000);
  const table = await startTable();
  const publicScene = testUlid('SCENE', 5);
  const prepScene = testUlid('SCENE', 6);
  const seatId = testUlid('SEAT', 5);
  const coDmSeatId = testUlid('SEAT', 6);
  const hostId = testUlid('HOST', 5);
  const playerId = testUlid('PLAYER', 5);
  const viewerId = testUlid('VIEWER', 5);
  const codmId = testUlid('CODM', 5);
  const clients: RawClient[] = [];
  try {
    const host = await RawClient.connect(table, {
      name: 'gate-host',
      identityId: hostId,
      identitySecret: 'gate-host',
      hostToken: table.hostToken,
    });
    clients.push(host);
    await host.waitFor('snapshot', () => host.state !== undefined);
    await ok(host.intent('scene.create', { sceneId: publicScene, name: 'Public' }));
    await ok(host.intent('scene.create', { sceneId: prepScene, name: 'Prep', dmOnly: true }));
    await ok(host.intent('scene.activate', { sceneId: publicScene }));
    await ok(host.intent('seat.create', { seatId, label: 'Player' }));
    await ok(host.intent('seat.create', { seatId: coDmSeatId, label: 'Co-DM', role: 'codm' }));

    const player = await RawClient.connect(table, {
      name: 'gate-player',
      identityId: playerId,
      identitySecret: 'gate-player',
    });
    clients.push(player);
    await player.waitFor('snapshot', () => player.state !== undefined);
    player.join(seatId);
    await player.waitFor('seat joined', () => JSON.stringify(player.state).includes(playerId));

    // No seat joined: an unseated connection is the shared spectator audience.
    const spectator = await RawClient.connect(table, {
      name: 'gate-viewer',
      identityId: viewerId,
      identitySecret: 'gate-viewer',
    });
    clients.push(spectator);
    await spectator.waitFor('snapshot', () => spectator.state !== undefined);

    const coDm = await RawClient.connect(table, {
      name: 'gate-codm',
      identityId: codmId,
      identitySecret: 'gate-codm',
    });
    clients.push(coDm);
    await coDm.waitFor('snapshot', () => coDm.state !== undefined);
    await ok(host.intent('seat.assign', { seatId: coDmSeatId, identityId: codmId }));
    await coDm.waitFor('co-DM joined', () => JSON.stringify(coDm.state).includes(codmId));

    const points = [
      { x: 1, y: 0, z: 1 },
      { x: 4, y: 0, z: 5 },
    ];
    const frames: readonly { channel: string; data: (sceneId: string) => unknown }[] = [
      { channel: 'ruler.preview', data: (sceneId) => ({ sceneId, points, phase: 'active' }) },
      {
        channel: 'draw.stroke',
        data: (sceneId) => ({
          sceneId,
          strokeId: testUlid('STROKE', sceneId === prepScene ? 1 : 2),
          color: '#e11d48',
          width: 0.12,
          phase: 'finished',
          points,
        }),
      },
      { channel: 'cursor', data: (sceneId) => ({ sceneId, x: 1, z: 1 }) },
    ];

    for (const { channel, data } of frames) {
      host.ephemeral(channel, data(prepScene));
      await coDm.waitFor(
        `the prep ${channel} relayed to the co-DM`,
        () => framesOn(coDm.frames, channel, hostId) === 1,
      );
      // A control frame on the public scene: frames arrive in order on one WebSocket, so once it is
      // seen the prep frame cannot still be in flight to the player or the spectator.
      host.ephemeral(channel, data(publicScene));
      await player.waitFor(
        `the public ${channel} reached the player`,
        () => framesOn(player.frames, channel, hostId) === 1,
      );
      await spectator.waitFor(
        `the public ${channel} reached the spectator`,
        () => framesOn(spectator.frames, channel, hostId) === 1,
      );
      await coDm.waitFor(
        `the public ${channel} reached the co-DM`,
        () => framesOn(coDm.frames, channel, hostId) === 2,
      );
    }

    // MV-282: a channel the relay does not know, and a cursor that names no scene by `sceneId`,
    // reach nobody — not even the co-DM — whatever key carries the scene.
    host.ephemeral('pointer', { scene: prepScene, x: 1, z: 1 });
    host.ephemeral('cursor', { targetSceneId: prepScene, x: 2, z: 2 });
    host.ephemeral('cursor', { sceneId: publicScene, x: 3, z: 3 });
    for (const [client, count] of [
      [player, 2],
      [spectator, 2],
      [coDm, 3],
    ] as const) {
      await client.waitFor(
        'the control cursor after the dropped frames',
        () => framesOn(client.frames, 'cursor', hostId) === count,
      );
      expect(framesOn(client.frames, 'pointer', hostId)).toBe(0);
      expect(client.frames.join('\n')).not.toContain('targetSceneId');
    }

    expect(player.frames.join('\n')).not.toContain(prepScene);
    expect(spectator.frames.join('\n')).not.toContain(prepScene);
    expect(coDm.frames.join('\n')).toContain(prepScene);
  } finally {
    await Promise.all(clients.map((client) => client.close()));
    await table.stop();
  }
});
