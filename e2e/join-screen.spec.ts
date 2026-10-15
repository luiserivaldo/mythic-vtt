import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { RawClient, startTable, testUlid, type Table } from './harness.js';

// UX-45 / UI-JOIN-01 (MV-248): the join link shows the table before any socket opens; a visitor
// claims a seat, joins as a Temporary Player or as a counted, anonymous spectator. PERM-03: the
// pre-join payload and the spectator's socket reveal nothing a not-yet-joined viewer may not see.
let table: Table | undefined;

test.beforeAll(async () => {
  table = await startTable();
});
test.afterAll(async () => {
  await table?.stop();
});

const HOST = { identityId: testUlid('HOST', 45), identitySecret: 'join-screen-host' };
const DM_NAME = 'Mistress Vell';
const SECRETS = ['SECRET-JOIN-SCENE', 'SECRET-JOIN-TOKEN', 'ARCHIVED-JOIN-SEAT'];
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

interface Visitor {
  page: Page;
  /** Bodies of every `GET /api/join` this page fetched. */
  payloads: string[];
  received: string[];
  sent: string[];
  sockets: () => number;
  close: () => Promise<void>;
}

async function visit(browser: Browser, running: Table, errors: string[]): Promise<Visitor> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const payloads: string[] = [];
  const received: string[] = [];
  const sent: string[] = [];
  let sockets = 0;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (response) => {
    if (new URL(response.url()).pathname === '/api/join')
      void response.text().then((body) => payloads.push(body));
  });
  page.on('websocket', (ws) => {
    // Only the game socket; the dev server keeps its own reload socket.
    if (new URL(ws.url()).pathname !== '/ws') return;
    sockets++;
    ws.on('framereceived', (f) => received.push(String(f.payload)));
    ws.on('framesent', (f) => sent.push(String(f.payload)));
  });
  await page.goto(running.clientUrl);
  return { page, payloads, received, sent, sockets: () => sockets, close: () => context.close() };
}

test('claim, temporary player, spectator and an already-claimed seat, with no pre-join leaks', async ({
  browser,
}) => {
  if (!table) throw new Error('table not started');
  const errors: string[] = [];
  const setup = await RawClient.connect(table, {
    name: DM_NAME,
    ...HOST,
    hostToken: table.hostToken,
  });
  await setup.waitFor('snapshot', () => setup.state !== undefined);
  const hall = testUlid('SCENE', 45);
  const secretScene = testUlid('SCENE', 46);
  const wizard = testUlid('SEAT', 45);
  const archived = testUlid('SEAT', 47);
  for (const [type, payload] of [
    ['scene.create', { sceneId: hall, name: 'Great hall' }],
    ['scene.activate', { sceneId: hall }],
    ['scene.create', { sceneId: secretScene, name: 'SECRET-JOIN-SCENE', dmOnly: true }],
    [
      'entity.create',
      {
        sceneId: hall,
        entity: {
          id: testUlid('TOKEN', 45),
          layer: 'dm',
          name: 'SECRET-JOIN-TOKEN',
          owners: [],
          transform: {
            position: { x: 4, y: 0, z: 4 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
          },
          token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
        },
      },
    ],
    ['seat.create', { seatId: wizard, label: 'Wizard', icon: { kind: 'glyph', value: 'W' } }],
    ['seat.create', { seatId: testUlid('SEAT', 46), label: 'Rogue' }],
    ['seat.create', { seatId: archived, label: 'ARCHIVED-JOIN-SEAT' }],
    ['seat.archive', { seatId: archived }],
    ['campaign.setBranding', { icon: { kind: 'glyph', value: 'V' } }],
  ] as const)
    expect((await setup.intent(type, payload)).t, type).toBe('ack');

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
  dm.on('pageerror', (e) => errors.push(e.message));
  await dm.goto(table.clientUrl);
  await expect(dm.getByRole('status')).toHaveText('Connected to New campaign');
  await expect(dm.getByRole('dialog')).toHaveCount(0);
  await dm.getByRole('tab', { name: 'Seats', exact: true }).click();
  await expect(dm.getByLabel('Spectators')).toHaveText('Spectators watching: 0');

  // The link immediately shows the DM, the campaign and the seats, before any socket opens.
  const zara = await visit(browser, table, errors);
  await expect(zara.page.getByRole('dialog', { name: 'Join the table' })).toBeVisible();
  await expect(zara.page.getByLabel('Campaign')).toHaveText('New campaign');
  await expect(zara.page.getByLabel('Game Master')).toContainText(DM_NAME);
  await expect(zara.page.getByRole('button', { name: 'Claim Wizard' })).toBeEnabled();
  await expect(zara.page.getByRole('button', { name: 'Claim Rogue' })).toBeEnabled();
  await expect(zara.page.getByRole('button', { name: 'Temporary Player' })).toBeVisible();
  await expect(zara.page.getByRole('button', { name: 'Join As Spectator' })).toBeVisible();
  await expect(zara.page.getByText('ARCHIVED-JOIN-SEAT')).toHaveCount(0);
  expect(zara.sockets()).toBe(0);

  const shots = process.env['JOIN_SHOTS'];
  if (shots) {
    mkdirSync(shots, { recursive: true });
    for (const [w, h] of [
      [1280, 720],
      [390, 844],
    ] as const) {
      await zara.page.setViewportSize({ width: w, height: h });
      await zara.page.screenshot({ path: join(shots, `join-${String(w)}.png`) });
    }
    await zara.page.setViewportSize({ width: 1280, height: 720 });
  }

  // A second visitor opens the Wizard name step before Zara claims it.
  const tamsin = await visit(browser, table, errors);
  await tamsin.page.getByRole('button', { name: 'Claim Wizard', exact: true }).click();
  await expect(tamsin.page.getByRole('heading', { name: 'Claim Wizard' })).toBeVisible();

  // Claim: one name step, with an avatar that is kept for later visits. Back opens no socket.
  await zara.page.getByRole('button', { name: 'Claim Rogue', exact: true }).click();
  await zara.page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(zara.page.getByRole('dialog', { name: 'Join the table' })).toBeVisible();
  expect(zara.sockets()).toBe(0);
  await zara.page.getByRole('button', { name: 'Claim Wizard', exact: true }).click();
  await expect(zara.page.getByRole('heading', { name: 'Claim Wizard' })).toBeVisible();
  await zara.page.getByLabel('Avatar (optional)').setInputFiles({
    name: 'avatar.png',
    mimeType: 'image/png',
    buffer: Buffer.from(PNG, 'base64'),
  });
  await expect(zara.page.locator('.join-avatar-row img.join-avatar')).toBeVisible();
  await zara.page.getByLabel('Display name').fill('Zara the Bold');
  await zara.page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(zara.page.getByRole('dialog')).toHaveCount(0);
  await expect(zara.page.getByLabel('Current identity')).toContainText('Zara the Bold');
  await expect(zara.page.getByLabel('Current identity')).toContainText('Wizard');
  await expect(dm.getByRole('listitem', { name: 'Wizard seat' })).toContainText('Online');

  // A seat already claimed: the late claim is refused in plain words, and the list then shows the
  // seat as claimed without naming who holds it.
  await tamsin.page.getByLabel('Display name').fill('Tamsin');
  await tamsin.page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(tamsin.page.getByRole('alert')).toHaveText(
    'That seat was just claimed. Pick another.',
  );
  await expect(tamsin.page.getByRole('button', { name: 'Claim Wizard' })).toBeDisabled();
  await expect(
    tamsin.page.getByRole('listitem').filter({ hasText: 'Wizard' }).getByText('Claimed'),
  ).toBeVisible();
  await expect(tamsin.page.getByRole('dialog')).not.toContainText('Zara');

  // Temporary Player: a display name only; the seat name is shown after joining.
  await tamsin.page.getByRole('button', { name: 'Temporary Player' }).click();
  await expect(tamsin.page.getByLabel('Display name')).toHaveValue('Tamsin');
  await expect(tamsin.page.getByLabel('Your colour')).toHaveCount(0);
  await expect(tamsin.page.getByLabel('Avatar (optional)')).toHaveCount(0);
  await tamsin.page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(tamsin.page.getByRole('dialog')).toHaveCount(0);
  await expect(tamsin.page.getByLabel('Current identity')).toContainText('Tamsin');
  await expect(tamsin.page.getByLabel('Current identity')).toContainText('Player');

  // Join As Spectator: no name, no avatar, no colour; the DM sees a count, not a person.
  const watcher = await visit(browser, table, errors);
  await expect(watcher.page.getByRole('button', { name: 'Claim Wizard' })).toBeDisabled();
  // Temporary seats are session-only and never listed before joining.
  await expect(watcher.page.getByRole('button', { name: 'Claim Tamsin' })).toHaveCount(0);
  await watcher.page.getByRole('button', { name: 'Join As Spectator' }).click();
  await expect(watcher.page.getByRole('dialog')).toHaveCount(0);
  await expect(watcher.page.getByRole('button', { name: 'Watching: choose a seat' })).toBeVisible();
  await expect(dm.getByLabel('Spectators')).toHaveText('Spectators watching: 1');
  const roster = dm.getByRole('list', { name: 'Connected identities' });
  await expect(roster).toContainText('Zara the Bold');
  await expect(roster).toContainText('Tamsin');
  await expect(roster).not.toContainText('Unseated');
  await expect(roster.getByRole('listitem')).toHaveCount(2);
  const hello = watcher.sent.map((f) => JSON.parse(f) as Record<string, unknown>);
  expect(hello.find((m) => m['t'] === 'hello')).toMatchObject({ displayName: 'Spectator' });
  expect(hello.find((m) => m['t'] === 'hello')).not.toHaveProperty('avatar');
  expect(hello.find((m) => m['t'] === 'hello')).not.toHaveProperty('color');
  expect(hello).toContainEqual({ t: 'join', as: 'spectator' });

  // SES-06 and the kept avatar: Zara comes back into the Wizard seat with no screen.
  await zara.page.reload();
  await expect(zara.page.getByRole('status')).toHaveText('Connected to New campaign');
  await expect(zara.page.getByRole('dialog')).toHaveCount(0);
  await expect(zara.page.getByLabel('Current identity')).toContainText('Wizard');
  const profile = await zara.page.evaluate(
    () => JSON.parse(localStorage.getItem('mythic.profile.v1') ?? '{}') as { avatar?: string },
  );
  expect(profile.avatar).toMatch(/^data:image\//);

  // PERM-03: nothing hidden, no identity and no temporary seat in any pre-join payload.
  const zaraId = await zara.page.evaluate(
    () =>
      (JSON.parse(localStorage.getItem('mythic.identity.v1') ?? '{}') as { identityId: string })
        .identityId,
  );
  const payloads = [...zara.payloads, ...tamsin.payloads, ...watcher.payloads];
  expect(payloads.length).toBeGreaterThan(2);
  for (const body of payloads) {
    for (const secret of [...SECRETS, zaraId, HOST.identityId, 'Zara', 'Tamsin', 'spectators'])
      expect(body).not.toContain(secret);
  }
  // The spectator's socket names no other visitor and carries no DM-only data.
  const watched = watcher.received.join('\n');
  for (const secret of [...SECRETS, zaraId, 'Zara the Bold', '"t":"presence"'])
    expect(watched).not.toContain(secret);
  for (const secret of SECRETS) expect(tamsin.received.join('\n')).not.toContain(secret);
  expect(errors).toEqual([]);

  await zara.close();
  await tamsin.close();
  await watcher.close();
  await dmContext.close();
  await setup.close();
});
