import { expect, test } from '@playwright/test';
import { Campaign } from '../packages/shared/src/index.js';
import { RawClient, startTable, testUlid } from './harness.js';

test('pin audience policy holds in raw snapshots, edits, layer transitions and crash recovery', async () => {
  const table = await startTable();
  const hostIdentity = { identityId: testUlid('HOST', 1), identitySecret: 'pin-host' };
  const playerIdentity = { identityId: testUlid('PLAYER', 1), identitySecret: 'pin-player' };
  const spectatorIdentity = { identityId: testUlid('OBSERVER', 1), identitySecret: 'pin-observer' };
  const clients: RawClient[] = [];
  try {
    let host = await RawClient.connect(table, {
      name: 'DM',
      ...hostIdentity,
      hostToken: table.hostToken,
    });
    clients.push(host);
    const sceneId = testUlid('SCENE', 1),
      entityId = testUlid('PIN', 1),
      seatId = testUlid('SEAT', 1);
    expect(await host.intent('scene.create', { sceneId, name: 'Notes' })).toMatchObject({
      t: 'ack',
    });
    expect(await host.intent('scene.activate', { sceneId })).toMatchObject({ t: 'ack' });
    expect(
      await host.intent('seat.create', { seatId, label: 'Player', role: 'player' }),
    ).toMatchObject({ t: 'ack' });
    expect(
      await host.intent('seat.assign', { seatId, identityId: playerIdentity.identityId }),
    ).toMatchObject({ t: 'ack' });
    expect(
      await host.intent('entity.create', {
        sceneId,
        entity: {
          id: entityId,
          name: 'Note marker',
          layer: 'tokens',
          owners: [seatId],
          transform: {
            position: { x: 3, y: 0, z: 3 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
          },
          pin: { text: 'Hover is public', reveal: 'hover' },
          legacyPin: { text: 'PRIVATE-ARCHIVE' },
        },
      }),
    ).toMatchObject({ t: 'ack' });
    let player = await RawClient.connect(table, { name: 'Player', ...playerIdentity });
    let spectator = await RawClient.connect(table, { name: 'Spectator', ...spectatorIdentity });
    clients.push(player, spectator);
    for (const client of [player, spectator]) {
      await client.waitFor('snapshot', () => client.state !== undefined);
      expect(JSON.stringify(client.frames)).toContain('Hover is public');
      expect(JSON.stringify(client.frames)).not.toContain('PRIVATE-ARCHIVE');
    }
    expect(
      await host.intent('pin.update', {
        sceneId,
        entityId,
        changes: { text: 'Click is public', reveal: 'click' },
      }),
    ).toMatchObject({ t: 'ack' });
    for (const client of [player, spectator]) {
      await client.waitForSeq(host.lastSeq);
      expect(JSON.stringify(client.frames)).toContain('Click is public');
    }
    expect(
      await host.intent('entity.update', {
        sceneId,
        entityId,
        changes: { pin: { text: 'Bypass', reveal: 'click' } },
      }),
    ).toMatchObject({ t: 'reject' });
    expect(
      await player.intent('pin.update', { sceneId, entityId, changes: { text: 'Unauthorized' } }),
    ).toMatchObject({ t: 'reject' });
    expect(
      await host.intent('pin.update', {
        sceneId,
        entityId,
        changes: { text: 'PRIVATE-PROXIMITY', reveal: { proximity: 3 } },
      }),
    ).toMatchObject({ t: 'ack' });
    for (const layer of ['dm', 'tokens']) {
      expect(await host.intent('entity.setLayer', { sceneId, entityId, layer })).toMatchObject({
        t: 'ack',
      });
      for (const client of [player, spectator]) {
        await client.waitForSeq(host.lastSeq);
        expect(JSON.stringify(client.frames)).not.toMatch(/PRIVATE-PROXIMITY|PRIVATE-ARCHIVE/);
      }
    }
    await Promise.all(clients.map((client) => client.close()));
    await table.restart('SIGKILL');
    host = await RawClient.connect(table, { name: 'DM', ...hostIdentity });
    player = await RawClient.connect(table, { name: 'Player', ...playerIdentity });
    spectator = await RawClient.connect(table, { name: 'Spectator', ...spectatorIdentity });
    clients.push(host, player, spectator);
    for (const client of [host, player, spectator])
      await client.waitFor('recovered snapshot', () => client.state !== undefined);
    expect(Campaign.parse(host.state).scenes[sceneId]?.entities[entityId]?.pin?.text).toBe(
      'PRIVATE-PROXIMITY',
    );
    for (const client of [player, spectator]) {
      expect(Campaign.parse(client.state).scenes[sceneId]?.entities[entityId]?.pin).toBeUndefined();
      expect(JSON.stringify(client.frames)).not.toMatch(/PRIVATE-PROXIMITY|PRIVATE-ARCHIVE/);
    }
    expect(
      await host.intent('pin.update', { sceneId, entityId, changes: { reveal: 'click' } }),
    ).toMatchObject({ t: 'ack' });
    for (const client of [player, spectator]) {
      await client.waitForSeq(host.lastSeq);
      expect(Campaign.parse(client.state).scenes[sceneId]?.entities[entityId]?.pin?.text).toBe(
        'PRIVATE-PROXIMITY',
      );
      expect(JSON.stringify(client.frames)).not.toContain('PRIVATE-ARCHIVE');
    }
  } finally {
    await Promise.all(clients.map((client) => client.close()));
    await table.stop();
  }
});
