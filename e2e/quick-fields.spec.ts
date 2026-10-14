import { expect, test } from '@playwright/test';
import { RawClient, startTable, testUlid, type Reply } from './harness.js';

// UX-07 / PERM-03: inspect actual serialized traffic, not DOM visibility.
test('quick fields stay private across updates, ownership changes and reconnects', async () => {
  const table = await startTable();
  const clients: RawClient[] = [];
  const connect = async (name: string, extra = {}) => {
    const client = await RawClient.connect(table, {
      name,
      identityId: testUlid(name, 1),
      identitySecret: `${name}-secret`,
      ...extra,
    });
    clients.push(client);
    await client.waitFor('snapshot', () => client.state !== undefined);
    return client;
  };
  const ok = async (reply: Promise<Reply>) => {
    expect(await reply).toMatchObject({ t: 'ack' });
  };
  try {
    const host = await connect('HOST', { hostToken: table.hostToken });
    const sceneId = testUlid('SCENE', 1);
    const seatId = testUlid('SEAT', 1);
    const entityId = testUlid('TOKEN', 1);
    await ok(host.intent('scene.create', { sceneId, name: 'Quick fields' }));
    await ok(host.intent('seat.create', { seatId, label: 'Owner' }));
    const owner = await connect('OWNER');
    owner.join(seatId);
    await owner.waitFor('seat', () => JSON.stringify(owner.state).includes(testUlid('OWNER', 1)));
    await host.waitForSeq(owner.lastSeq);
    const spectator = await connect('WATCH');
    await ok(
      host.intent('entity.create', {
        sceneId,
        entity: {
          id: entityId,
          name: 'Visible token',
          layer: 'tokens',
          owners: [seatId],
          transform: {
            position: { x: 2, y: 0, z: 2 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
          },
          token: {
            sizeCells: 1,
            heightCells: 1,
            labelVisibility: 'all',
            quickFields: {
              hp: { value: 817263, visibility: 'owner', color: '#a1b2c3' },
              ac: { value: 918274, visibility: 'dm', color: '#d4e5f6' },
              speed: { value: 6, visibility: 'all' },
            },
          },
        },
      }),
    );
    const settle = () => Promise.all([owner, spectator].map((c) => c.waitForSeq(host.lastSeq)));
    await settle();
    expect(JSON.stringify(owner.state)).toContain('817263');
    expect(JSON.stringify(owner.state)).not.toContain('918274');
    expect(JSON.stringify(spectator.state)).toContain('"speed"');
    const fresh = await connect('FRESH');
    expect(fresh.frames.join('\n')).not.toMatch(/817263|918274|a1b2c3|d4e5f6/);
    await ok(
      host.intent('token.setQuickField', {
        sceneId,
        entityId,
        fieldId: 'ac',
        field: { value: 928375, visibility: 'dm' },
      }),
    );
    await settle();
    await ok(host.intent('entity.setOwners', { sceneId, entityId, owners: [] }));
    await settle();
    expect(JSON.stringify(owner.state)).not.toContain('817263');
    await ok(
      host.intent('token.setQuickField', {
        sceneId,
        entityId,
        fieldId: 'hp',
        field: { value: 837465, visibility: 'owner' },
      }),
    );
    await settle();
    const lastSeq = owner.lastSeq;
    const initialState = owner.state;
    await owner.close();
    await ok(
      host.intent('token.setQuickField', {
        sceneId,
        entityId,
        fieldId: 'hp',
        field: { value: 847576, visibility: 'owner' },
      }),
    );
    const replay = await RawClient.connect(table, {
      name: 'OWNER',
      identityId: testUlid('OWNER', 1),
      identitySecret: 'OWNER-secret',
      lastSeq,
      initialState,
    });
    clients.push(replay);
    await replay.waitForSeq(host.lastSeq);
    for (const c of [spectator, fresh, replay])
      expect(c.frames.join('\n')).not.toMatch(/817263|918274|928375|837465|847576|a1b2c3|d4e5f6/);
    expect(replay.frames.some((frame) => frame.includes('"t":"patch"'))).toBe(true);
    expect(owner.frames.join('\n')).not.toMatch(/918274|928375|837465|d4e5f6/);
    expect(host.frames.join('\n')).toContain('928375');
  } finally {
    await Promise.all(clients.map((c) => c.close()));
    await table.stop();
  }
});
