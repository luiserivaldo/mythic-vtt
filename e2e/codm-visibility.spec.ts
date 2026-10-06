import { expect, test } from '@playwright/test';
import { RawClient, startTable, testUlid, type Reply, type Table } from './harness.js';

// D32: a co-DM seat sees the DM layer but it is read-only for it; players still never see it.

let table: Table;
let host: RawClient;
const SCENE = testUlid('SCENE', 1);
const CODM_SEAT = testUlid('SEAT', 1);
const PLAYER_SEAT = testUlid('SEAT', 2);
const SECRET_ID = testUlid('SECRETENT', 1);
const SECRET_NAME = 'Vorgrath the Hidden D32';

const one = { x: 1, y: 1, z: 1 };
const secret = {
  id: SECRET_ID,
  layer: 'dm',
  name: SECRET_NAME,
  owners: [],
  transform: { position: { x: 2, y: 0, z: 3 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: one },
};

async function ok(reply: Promise<Reply>): Promise<number> {
  const r = await reply;
  expect(r, JSON.stringify(r)).toMatchObject({ t: 'ack' });
  return r.seq ?? -1;
}

const hasSecret = (c: RawClient) =>
  JSON.stringify(
    (c.state as { scenes?: Record<string, unknown> } | undefined)?.scenes?.[SCENE] ?? {},
  ).includes(SECRET_ID);

test.beforeAll(async () => {
  table = await startTable();
  host = await RawClient.connect(table, {
    name: 'host',
    identityId: testUlid('HOST', 1),
    identitySecret: 'host-secret',
    hostToken: table.hostToken,
  });
  await host.waitFor('host snapshot', () => host.state !== undefined);
});

test.afterAll(async () => {
  await host.close();
  await table.stop();
});

test('a promoted co-DM seat receives the DM layer but cannot edit it; players never get it', async () => {
  await ok(host.intent('scene.create', { sceneId: SCENE, name: 'Crypt' }));
  await ok(host.intent('seat.create', { seatId: CODM_SEAT, label: 'Co-DM' }));
  await ok(host.intent('seat.create', { seatId: PLAYER_SEAT, label: 'Rogue' }));
  await ok(host.intent('entity.create', { sceneId: SCENE, entity: secret }));

  const connect = (name: string, id: string) =>
    RawClient.connect(table, { name, identityId: id, identitySecret: `${name}-secret` });
  const coDm = await connect('codm', testUlid('CODM', 1));
  const player = await connect('player', testUlid('PLAYER', 1));
  await coDm.waitFor('snapshot', () => coDm.state !== undefined);
  await player.waitFor('snapshot', () => player.state !== undefined);
  coDm.join(CODM_SEAT);
  player.join(PLAYER_SEAT);
  await host.waitForSeq(Math.max(coDm.lastSeq, player.lastSeq));

  // Still a player: nothing on the DM layer.
  await coDm.waitForSeq(host.lastSeq);
  expect(hasSecret(coDm)).toBe(false);

  // Promotion triggers a fresh, co-DM-filtered snapshot that includes the DM-layer entity.
  const framesBefore = coDm.frames.length;
  await ok(host.intent('seat.update', { seatId: CODM_SEAT, role: 'codm' }));
  await coDm.waitFor('dm entity after promotion', () => hasSecret(coDm));
  expect(coDm.frames.slice(framesBefore).some((f) => f.includes('"t":"snapshot"'))).toBe(true);

  // Read-only: edits, moves, deletes, layer changes and creates on the DM layer are rejected.
  const rejected = async (type: string, payload: Record<string, unknown>) => {
    expect(await coDm.intent(type, payload), type).toMatchObject({ t: 'reject' });
  };
  await rejected('entity.update', { sceneId: SCENE, entityId: SECRET_ID, changes: { name: 'x' } });
  await rejected('entity.update', {
    sceneId: SCENE,
    entityId: SECRET_ID,
    changes: { transform: secret.transform },
  });
  await rejected('entity.setLayer', { sceneId: SCENE, entityId: SECRET_ID, layer: 'tokens' });
  await rejected('entity.delete', { sceneId: SCENE, entityId: SECRET_ID });
  await rejected('layer.lock', { sceneId: SCENE, layer: 'dm', locked: true });

  // Live edits by the host reach the co-DM and still never the player.
  await ok(
    host.intent('entity.update', {
      sceneId: SCENE,
      entityId: SECRET_ID,
      changes: { name: 'Renamed' },
    }),
  );
  await coDm.waitForSeq(host.lastSeq);
  await player.waitForSeq(host.lastSeq);
  expect(JSON.stringify(coDm.state)).toContain('Renamed');
  expect(player.frames.filter((f) => f.includes(SECRET_ID) || f.includes(SECRET_NAME))).toEqual([]);
  expect(player.frames.some((f) => f.includes('Renamed'))).toBe(false);
  expect(hasSecret(player)).toBe(false);

  await coDm.close();
  await player.close();
});
