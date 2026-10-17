import { expect, test } from '@playwright/test';
import { RawClient, startTable, testUlid, type Table } from './harness.js';

// D46 / MV-280: "Join As Spectator" declares the spectator on `hello`, so the host counts it
// before its first presence frame. Raw frames on the DM socket prove the DM roster never lists the
// spectator as unseated, not even for one frame, and the count goes straight from 0 to 1.
let table: Table | undefined;

test.beforeAll(async () => {
  table = await startTable();
});
test.afterAll(async () => {
  await table?.stop();
});

const HOST = { identityId: testUlid('HOST', 280), identitySecret: 'spectator-hello-host' };
const DM_NAME = 'Warden Ost';

interface PresenceFrame {
  t: 'presence';
  spectators: number;
  unseated?: { identityId: string; displayName: string }[];
}

test('the DM never sees a Join As Spectator connection as unseated', async ({ browser }) => {
  if (!table) throw new Error('table not started');
  const errors: string[] = [];
  const setup = await RawClient.connect(table, {
    name: DM_NAME,
    ...HOST,
    hostToken: table.hostToken,
  });
  await setup.waitFor('snapshot', () => setup.state !== undefined);
  const hall = testUlid('SCENE', 280);
  for (const [type, payload] of [
    ['scene.create', { sceneId: hall, name: 'Watch hall' }],
    ['scene.activate', { sceneId: hall }],
    ['seat.create', { seatId: testUlid('SEAT', 280), label: 'Knight' }],
  ] as const)
    expect((await setup.intent(type, payload)).t, type).toBe('ack');

  // The DM page records every frame its game socket receives, from before it connects.
  const dmContext = await browser.newContext();
  await dmContext.addInitScript(
    ({ identity, name }) => {
      localStorage.setItem('mythic.identity.v1', JSON.stringify(identity));
      localStorage.setItem('mythic.host', '1');
      localStorage.setItem('mythic.profile.v1', JSON.stringify({ displayName: name }));
    },
    { identity: HOST, name: DM_NAME },
  );
  const dm = await dmContext.newPage();
  const dmFrames: string[] = [];
  dm.on('pageerror', (e) => errors.push(e.message));
  dm.on('websocket', (ws) => {
    if (new URL(ws.url()).pathname !== '/ws') return;
    ws.on('framereceived', (f) => dmFrames.push(String(f.payload)));
  });
  await dm.goto(table.clientUrl);
  await expect(dm.getByRole('status')).toHaveText('Connected to New campaign');
  await dm.getByRole('tab', { name: 'Seats', exact: true }).click();
  await expect(dm.getByLabel('Spectators')).toHaveText('Spectators watching: 0');
  const presences = () =>
    dmFrames
      .map((f) => JSON.parse(f) as { t: string })
      .filter((m): m is PresenceFrame => m.t === 'presence');
  expect(presences().length).toBeGreaterThan(0);

  const watcherContext = await browser.newContext();
  const watcher = await watcherContext.newPage();
  const watcherSent: string[] = [];
  watcher.on('pageerror', (e) => errors.push(e.message));
  watcher.on('websocket', (ws) => {
    if (new URL(ws.url()).pathname !== '/ws') return;
    ws.on('framesent', (f) => watcherSent.push(String(f.payload)));
  });
  await watcher.goto(table.clientUrl);
  await watcher.getByRole('button', { name: 'Join As Spectator' }).click();
  await expect(watcher.getByRole('button', { name: 'Watching: choose a seat' })).toBeVisible();
  await expect(dm.getByLabel('Spectators')).toHaveText('Spectators watching: 1');

  const spectatorId = await watcher.evaluate(
    () =>
      (
        JSON.parse(localStorage.getItem('mythic.spectator-identity.v1') ?? '{}') as {
          identityId?: string;
        }
      ).identityId,
  );
  expect(spectatorId).toMatch(/^[0-9A-Z]{26}$/);
  // No DM frame ever names the spectator identity, and no presence lists a "Spectator" visitor.
  for (const frame of dmFrames) expect(frame).not.toContain(spectatorId ?? '-');
  for (const presence of presences())
    expect(presence.unseated?.map((u) => u.displayName) ?? []).not.toContain('Spectator');
  // The count goes straight from 0 to 1, with no intermediate frame listing the connection.
  const counts = presences()
    .map((p) => p.spectators)
    .filter((n, i, all) => i === 0 || all[i - 1] !== n);
  expect(counts).toEqual([0, 1]);
  // The watcher declared itself on hello and sent no follow-up join.
  const sent = watcherSent.map((f) => JSON.parse(f) as Record<string, unknown>);
  expect(sent.find((m) => m['t'] === 'hello')).toMatchObject({
    identityId: spectatorId,
    as: 'spectator',
  });
  expect(sent.filter((m) => m['t'] === 'join')).toEqual([]);
  // With nobody unseated the DM shows no roster of connected identities at all.
  await expect(dm.getByRole('list', { name: 'Connected identities' })).toHaveCount(0);
  expect(errors).toEqual([]);

  await watcherContext.close();
  await dmContext.close();
  await setup.close();
});
