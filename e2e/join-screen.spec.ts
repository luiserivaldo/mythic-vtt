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

async function visit(
  browser: Browser,
  running: Table,
  errors: string[],
  stored: Record<string, string> = {},
): Promise<Visitor> {
  const context = await browser.newContext();
  // What this browser already holds in localStorage (identity, profile), set once.
  await context.addInitScript((entries) => {
    if (sessionStorage.getItem('e2e.seeded') === '1') return;
    sessionStorage.setItem('e2e.seeded', '1');
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
  }, stored);
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
  // D46 / MV-280: the spectator intent rides on hello; no follow-up join is sent.
  expect(hello.find((m) => m['t'] === 'hello')).toMatchObject({ as: 'spectator' });
  expect(hello.filter((m) => m['t'] === 'join')).toEqual([]);

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

// MV-270, restoring #118's lost coverage: the DM seats an unseated visitor from the Seats tab's
// roster dropdown, and no roster ever reaches a player socket (PERM-03). Also: a legacy
// `spectator: true` profile is migrated to `awaitingSeat` (it is not a spectator), and a seat-bound
// identity with no stored profile that picks Join As Spectator watches anonymously instead of
// taking its seat back.
test('the DM seats a remembered visitor from the roster; spectators stay anonymous', async ({
  browser,
}) => {
  if (!table) throw new Error('table not started');
  const errors: string[] = [];
  const setup = await RawClient.connect(table, { name: DM_NAME, ...HOST });
  await setup.waitFor('snapshot', () => setup.state !== undefined);
  const scene = testUlid('SCENE', 2702);
  const ranger = testUlid('SEAT', 2702);
  const bard = testUlid('SEAT', 2703);
  const bardIdentity = { identityId: testUlid('BARD', 2703), identitySecret: 'bound-bard' };
  for (const [type, payload] of [
    ['scene.create', { sceneId: scene, name: 'Roster hall' }],
    ['scene.activate', { sceneId: scene }],
    ['seat.create', { seatId: ranger, label: 'Ranger' }],
    ['seat.create', { seatId: bard, label: 'Bard' }],
    ['seat.assign', { seatId: bard, identityId: bardIdentity.identityId }],
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
  await dm.getByRole('tab', { name: 'Seats', exact: true }).click();

  // A returning visitor whose stored profile still carries the legacy spectator flag: it is
  // rewritten as awaitingSeat, and the visitor waits under their name, never as a "spectator".
  const quinn = await visit(browser, table, errors, {
    'mythic.profile.v1': JSON.stringify({ displayName: 'Quinn', spectator: true }),
  });
  const storedProfile = () =>
    quinn.page.evaluate(
      () => JSON.parse(localStorage.getItem('mythic.profile.v1') ?? '{}') as unknown,
    );
  await expect(
    quinn.page.getByRole('button', { name: 'Waiting for a seat: choose one' }),
  ).toBeVisible();
  await expect(quinn.page.getByRole('button', { name: 'Watching: choose a seat' })).toHaveCount(0);
  expect(await storedProfile()).toEqual({ displayName: 'Quinn', awaitingSeat: true });
  await expect.poll(() => quinn.sockets()).toBe(1);

  // The DM seats Quinn from the dropdown, not by typing an identity id.
  const roster = dm.getByRole('list', { name: 'Connected identities' });
  await expect(roster).toContainText('Quinn');
  const seatRow = dm.getByRole('listitem', { name: 'Ranger seat', exact: true });
  await seatRow.locator('summary').click();
  const picker = seatRow.getByLabel('Connected participant for Ranger');
  const value = await picker.locator('option', { hasText: 'Quinn' }).getAttribute('value');
  expect(value).toMatch(/^[0-9A-Z]{26}$/);
  await picker.selectOption(value ?? '');
  await seatRow.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(quinn.page.getByRole('dialog')).toHaveCount(0);
  await expect(quinn.page.getByLabel('Current identity')).toContainText('Quinn');
  await expect(quinn.page.getByLabel('Current identity')).toContainText('Ranger');
  await expect.poll(() => setup.state && JSON.stringify(setup.state)).toContain(value ?? '-');
  await expect.poll(storedProfile).toEqual({ displayName: 'Quinn', lastSeatId: ranger });

  // The Bard identity holds a seat but this browser has no stored profile. Join As Spectator
  // watches anonymously, under a separate identity: the Bard seat is not taken back as "Spectator".
  const watcher = await visit(browser, table, errors, {
    'mythic.identity.v1': JSON.stringify(bardIdentity),
  });
  await watcher.page.getByRole('button', { name: 'Join As Spectator' }).click();
  await expect(watcher.page.getByRole('button', { name: 'Watching: choose a seat' })).toBeVisible();
  await expect(dm.getByLabel('Spectators')).toHaveText('Spectators watching: 1');
  await expect(watcher.page.getByLabel('Current identity')).not.toContainText('Bard');
  const sent = watcher.sent.map((f) => JSON.parse(f) as Record<string, unknown>);
  const hello = sent.find((m) => m['t'] === 'hello');
  expect(hello?.['identityId']).toMatch(/^[0-9A-Z]{26}$/);
  expect(hello?.['identityId']).not.toBe(bardIdentity.identityId);
  expect(hello).toMatchObject({ as: 'spectator' });
  expect(sent.filter((m) => m['t'] === 'join')).toEqual([]);
  const presence = setup.frames
    .filter((f) => f.includes('"t":"presence"'))
    .map((f) => JSON.parse(f) as { seats: { seatId: string; connected: boolean }[] })
    .at(-1);
  expect(presence?.seats.find((s) => s.seatId === bard)).toMatchObject({ connected: false });
  expect(watcher.received.some((f) => f.includes(`"seatId":"${bard}"`))).toBe(false);
  await expect(roster).not.toContainText('Spectator');

  // PERM-03: no roster reaches a player or spectator socket, before or after being seated.
  expect(quinn.received.length).toBeGreaterThan(0);
  for (const frames of [quinn.received, watcher.received]) {
    expect(frames.some((f) => f.includes('"t":"presence"'))).toBe(false);
    expect(frames.join('\n')).not.toContain('unseated');
  }
  // D44: the spectator audience gets seats with a placeholder identity, and no visitor names.
  expect(watcher.received.join('\n')).not.toContain(bardIdentity.identityId);
  expect(watcher.received.join('\n')).not.toContain('Quinn');
  expect(errors).toEqual([]);

  await quinn.close();
  await watcher.close();
  await dmContext.close();
  await setup.close();
});
