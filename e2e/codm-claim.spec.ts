import { expect, test } from '@playwright/test';
import { RawClient, openClient, startTable, testUlid, type Reply, type Table } from './harness.js';

// MV-269: only the host grants a Co-DM seat (seat.assign or a SES-04 invite). A join-link visitor
// is never offered one, cannot claim one over the socket, and never sees the DM layer.

let table: Table;
let host: RawClient;
const SCENE = testUlid('SCENE', 269);
const CODM_SEAT = testUlid('SEAT', 269);
const PLAYER_SEAT = testUlid('SEAT', 270);
const SECRET_ID = testUlid('SECRETENT', 269);
const SECRET_NAME = 'Deputy-only secret MV269';

async function ok(reply: Promise<Reply>): Promise<void> {
  const r = await reply;
  expect(r, JSON.stringify(r)).toMatchObject({ t: 'ack' });
}

const seatHolder = (seatId: string) =>
  (host.state as { seats: Record<string, { identityId: string | null }> }).seats[seatId]
    ?.identityId;

test.beforeAll(async () => {
  table = await startTable();
  host = await RawClient.connect(table, {
    name: 'host',
    identityId: testUlid('HOST', 269),
    identitySecret: 'host-secret',
    hostToken: table.hostToken,
  });
  await host.waitFor('host snapshot', () => host.state !== undefined);
  await ok(host.intent('scene.create', { sceneId: SCENE, name: 'Keep' }));
  await ok(host.intent('scene.activate', { sceneId: SCENE }));
  await ok(host.intent('seat.create', { seatId: CODM_SEAT, label: 'Deputy', role: 'codm' }));
  await ok(host.intent('seat.create', { seatId: PLAYER_SEAT, label: 'Rogue' }));
  await ok(
    host.intent('entity.create', {
      sceneId: SCENE,
      entity: {
        id: SECRET_ID,
        layer: 'dm',
        name: SECRET_NAME,
        owners: [],
        transform: {
          position: { x: 2, y: 0, z: 3 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          scale: { x: 1, y: 1, z: 1 },
        },
      },
    }),
  );
});

test.afterAll(async () => {
  await host.close();
  await table.stop();
});

test('a join-link visitor is not offered a Co-DM seat and cannot claim one', async ({
  browser,
}) => {
  const response = await fetch(`http://127.0.0.1:${String(table.hostPort)}/api/join`);
  const body = await response.text();
  const payload = JSON.parse(body) as { seats: { seatId: string; role: string }[] };
  expect(payload.seats.map((s) => [s.seatId, s.role])).toEqual([[PLAYER_SEAT, 'player']]);
  expect(body).not.toContain(CODM_SEAT);

  // Over the socket, exactly as a hand-written client would try it.
  const visitor = await RawClient.connect(table, {
    name: 'visitor',
    identityId: testUlid('VISITOR', 269),
    identitySecret: 'visitor-secret',
  });
  await visitor.waitFor('snapshot', () => visitor.state !== undefined);
  visitor.join(CODM_SEAT);
  await visitor.waitFor('join refused', () =>
    visitor.frames.some((f) => f.includes('"code":"seat-unavailable"')),
  );
  expect(
    await visitor.intent('session.join', {
      seatId: CODM_SEAT,
      identityId: testUlid('VISITOR', 269),
    }),
  ).toMatchObject({ t: 'reject', reason: 'forbidden' });
  await ok(host.intent('scene.rename', { sceneId: SCENE, name: 'Keep still' }));
  await visitor.waitForSeq(host.lastSeq);
  expect(seatHolder(CODM_SEAT)).toBeNull();
  expect(visitor.frames.join('\n')).not.toContain(SECRET_NAME);
  expect(visitor.frames.join('\n')).not.toContain(SECRET_ID);
  await visitor.close();

  // In the join screen (UX-45) a player seat offers Claim; the Co-DM seat is not offered at all.
  const zara = await openClient(browser, table, 'zara', { joinScreen: true });
  await expect(zara.page.getByRole('button', { name: 'Claim Rogue', exact: true })).toBeEnabled();
  await expect(zara.page.getByRole('button', { name: 'Claim Deputy', exact: true })).toHaveCount(0);
  await expect(zara.page.getByText('Deputy')).toHaveCount(0);
  await zara.context.close();
});

test('an identity the host assigned to the Co-DM seat is seated as Co-DM', async () => {
  const deputyId = testUlid('DEPUTY', 269);
  await ok(host.intent('seat.assign', { seatId: CODM_SEAT, identityId: deputyId }));
  const deputy = await RawClient.connect(table, {
    name: 'deputy',
    identityId: deputyId,
    identitySecret: 'deputy-secret',
  });
  await deputy.waitFor('co-DM snapshot', () =>
    deputy.frames.some(
      (f) => f.includes('"t":"snapshot"') && f.includes(`"seatId":"${CODM_SEAT}"`),
    ),
  );
  // Rejoining a seat it already holds is allowed and changes nothing.
  deputy.join(CODM_SEAT);
  await ok(host.intent('scene.rename', { sceneId: SCENE, name: 'Keep again' }));
  await deputy.waitForSeq(host.lastSeq);
  expect(deputy.frames.some((f) => f.includes('"code":"seat-unavailable"'))).toBe(false);
  expect(seatHolder(CODM_SEAT)).toBe(deputyId);
  expect(JSON.stringify(deputy.state)).toContain(SECRET_NAME);
  await deputy.close();
});
