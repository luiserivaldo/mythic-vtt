import { expect, test } from '@playwright/test';
import { RawClient, startTable, testUlid, type Reply, type Table } from './harness.js';

// M4-02 / SES-11: the DM picks what spectators see (player view or one seat's view), live.
// PERM-03: no mode ever leaks the DM layer, the co-DM's extras or another seat's owner-only label.

const SCENE = testUlid('SCENE', 1);
const SEAT_A = testUlid('SEAT', 1);
const SEAT_B = testUlid('SEAT', 2);
const CODM_SEAT = testUlid('SEAT', 3);
const HOST_ID = testUlid('HOST', 1);
const SECRET_ID = testUlid('SECRETENT', 1);
const SECRET_NAME = 'Vorgrath the Hidden M402';
const LABEL_A = 'ALICE-ONLY-M402';
const LABEL_B = 'BOB-ONLY-M402';

const one = { x: 1, y: 1, z: 1 };
const transform = {
  position: { x: 2, y: 0, z: 3 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: one,
};
const labelled = (n: number, name: string, owner: string) => ({
  id: testUlid('LABELENT', n),
  layer: 'tokens',
  name,
  owners: [owner],
  transform,
  token: { sizeCells: 1, heightCells: 1, labelVisibility: 'owner' },
});

let table: Table;
let host: RawClient;
const clients: RawClient[] = [];

async function ok(reply: Promise<Reply>): Promise<number> {
  const r = await reply;
  expect(r, JSON.stringify(r)).toMatchObject({ t: 'ack' });
  return r.seq ?? -1;
}

const api = async (method: string, body?: unknown) => {
  const response = await fetch(`http://127.0.0.1:${String(table.hostPort)}/api/spectator-view`, {
    method,
    headers: {
      Authorization: `Mythic ${HOST_ID}.host-secret`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return response.status;
};

const snapshots = (c: RawClient) => c.frames.filter((f) => f.includes('"t":"snapshot"'));
const lastSnapshot = (c: RawClient) => snapshots(c).at(-1) ?? '';

test.beforeAll(async () => {
  table = await startTable();
  host = await RawClient.connect(table, {
    name: 'host',
    identityId: HOST_ID,
    identitySecret: 'host-secret',
    hostToken: table.hostToken,
  });
  clients.push(host);
  await host.waitFor('host snapshot', () => host.state !== undefined);
});

test.afterAll(async () => {
  await Promise.all(clients.map((c) => c.close()));
  await table.stop();
});

test('the DM switches the spectator view live, and no mode leaks DM-layer data or other seats’ labels', async () => {
  await ok(host.intent('scene.create', { sceneId: SCENE, name: 'Crypt' }));
  await ok(host.intent('scene.activate', { sceneId: SCENE }));
  await ok(host.intent('seat.create', { seatId: SEAT_A, label: 'Alice' }));
  await ok(host.intent('seat.create', { seatId: SEAT_B, label: 'Bob' }));
  await ok(host.intent('seat.create', { seatId: CODM_SEAT, label: 'Co-DM', role: 'codm' }));
  await ok(
    host.intent('entity.create', {
      sceneId: SCENE,
      entity: { id: SECRET_ID, layer: 'dm', name: SECRET_NAME, owners: [], transform },
    }),
  );
  await ok(host.intent('entity.create', { sceneId: SCENE, entity: labelled(1, LABEL_A, SEAT_A) }));
  await ok(host.intent('entity.create', { sceneId: SCENE, entity: labelled(2, LABEL_B, SEAT_B) }));

  const created = await fetch(`http://127.0.0.1:${String(table.hostPort)}/api/spectator-link`, {
    method: 'POST',
    headers: { Authorization: `Mythic ${HOST_ID}.host-secret` },
  });
  const { token } = (await created.json()) as { token: string };
  const spectator = await RawClient.connect(table, {
    name: 'watcher',
    identityId: testUlid('WATCH', 1),
    identitySecret: 'watch-secret',
    watchToken: token,
  });
  clients.push(spectator);
  await spectator.waitFor('first snapshot', () => spectator.state !== undefined);

  const seen = () => spectator.frames.join('\n');
  const noDmData = () => {
    expect(seen()).not.toContain(SECRET_ID);
    expect(seen()).not.toContain(SECRET_NAME);
  };

  // Default: the player view, so no owner-only label at all.
  expect(lastSnapshot(spectator)).not.toContain(LABEL_A);
  expect(lastSnapshot(spectator)).not.toContain(LABEL_B);
  noDmData();

  // Invalid choices change nothing: a co-DM seat, an unknown seat, a malformed body.
  expect(await api('PUT', { seatId: CODM_SEAT })).toBe(400);
  expect(await api('PUT', { seatId: testUlid('NOSEAT', 1) })).toBe(400);
  expect(await api('PUT', { seat: SEAT_A })).toBe(400);
  expect(snapshots(spectator)).toHaveLength(1);

  // Seat A's view arrives live as one fresh snapshot; seat B's label stays out.
  expect(await api('PUT', { seatId: SEAT_A })).toBe(200);
  await spectator.waitFor('seat A view', () => lastSnapshot(spectator).includes(LABEL_A));
  expect(lastSnapshot(spectator)).not.toContain(LABEL_B);
  expect(snapshots(spectator)).toHaveLength(2);
  noDmData();

  // Seat B's view replaces it; seat A's label is gone from the held state.
  expect(await api('PUT', { seatId: SEAT_B })).toBe(200);
  await spectator.waitFor('seat B view', () => lastSnapshot(spectator).includes(LABEL_B));
  expect(lastSnapshot(spectator)).not.toContain(LABEL_A);
  expect(JSON.stringify(spectator.state)).not.toContain(LABEL_A);

  // Edits made while in seat mode reach the spectator as that seat would see them, no DM data.
  const seq = await ok(
    host.intent('entity.update', {
      sceneId: SCENE,
      entityId: SECRET_ID,
      changes: { name: `${SECRET_NAME}-edited` },
    }),
  );
  await ok(host.intent('scene.rename', { sceneId: SCENE, name: 'Crypt II' }));
  await spectator.waitForSeq(seq + 1);
  expect(JSON.stringify(spectator.state)).toContain('Crypt II');
  noDmData();

  // Back to the player view, then it is read-only in every mode.
  expect(await api('PUT', { seatId: null })).toBe(200);
  await spectator.waitFor('player view', () => !lastSnapshot(spectator).includes(LABEL_B));
  expect(JSON.stringify(spectator.state)).not.toContain(LABEL_B);
  expect(await api('GET')).toBe(200);
  expect(await spectator.intent('scene.rename', { sceneId: SCENE, name: 'Attack' })).toMatchObject({
    t: 'reject',
    reason: 'forbidden',
  });

  // Every frame of the whole run: no DM-layer data, never the co-DM-only content.
  noDmData();
  expect(host.frames.join('\n')).toContain(SECRET_NAME);
});
