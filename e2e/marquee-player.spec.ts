import { expect, test, type Page } from '@playwright/test';
import { connectAoEPlacer } from './aoe-fixture.js';
import {
  RawClient,
  recordPageFrames,
  stableBoardLayout,
  startTable,
  testUlid,
  type ScreenBox,
  type Table,
} from './harness.js';

// MV-275 (UI-TOOL-01, PERM-03): the selection marquee as a player. Candidates come from what the
// player's board draws (`visibleEntities`) and must pass `canSelect`, so a marquee over hidden or
// unselectable objects gathers only the player's own token. Each excluded object below would
// otherwise be selectable by a player seat (it grants `move`), so only its own guard keeps it out.

interface Diagnostics {
  __mythicRender?: { getSelection(): string[]; getObjectNames(): string[] };
}

const HOST = { identityId: testUlid('MQPHOST', 1), identitySecret: 'marquee-player-host' };
const PLAYER = { identityId: testUlid('MQPPLAYER', 1), identitySecret: 'marquee-player' };
const SEAT = testUlid('MQPSEAT', 1);
const SCENE = testUlid('MQPSCENE', 1);
const HERO = testUlid('MQPTOKEN', 1);
const DM_TOKEN = testUlid('MQPTOKEN', 2);
const UNSEEN = testUlid('MQPTOKEN', 3);
const MAP = testUlid('MQPMAP', 1);
const AOE = testUlid('MQPAOE', 1);
const DM_NAME = 'Lurking warden';
const UNSEEN_NAME = 'Unseen stalker';

let table: Table | undefined;

test.beforeAll(async () => {
  table = await startTable();
});

test.afterAll(async () => {
  await table?.stop();
});

const render = (page: Page) =>
  page.evaluate(() => {
    const diagnostics = (globalThis as unknown as Diagnostics).__mythicRender;
    return {
      selection: [...(diagnostics?.getSelection() ?? [])].sort(),
      objects: diagnostics?.getObjectNames() ?? [],
    };
  });

/** Zoom of an untouched view, which frames the default 40x30 scene whole with one cell of margin. */
const fitZoom = (box: ScreenBox) => Math.min(box.width / 42, box.height / 32);

const transform = (x: number, z: number, scale = 1) => ({
  position: { x, y: 0, z },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: scale, y: scale, z: scale },
});

const token = { sizeCells: 1, heightCells: 1, labelVisibility: 'all' } as const;

test('a player marquee gathers only what the player may select', async ({ browser }) => {
  test.setTimeout(120_000);
  if (!table) throw new Error('table not started');
  const host = await RawClient.connect(table, {
    name: 'marquee DM',
    ...HOST,
    hostToken: table.hostToken,
  });
  await host.waitFor('host snapshot', () => host.state !== undefined);
  const ok = async (reply: Promise<{ t: string }>) => {
    expect((await reply).t).toBe('ack');
  };
  await ok(host.intent('scene.create', { sceneId: SCENE, name: 'Player marquee' }));
  await ok(host.intent('scene.activate', { sceneId: SCENE }));
  await ok(host.intent('seat.create', { seatId: SEAT, label: 'Hero' }));
  await ok(host.intent('seat.assign', { seatId: SEAT, identityId: PLAYER.identityId }));

  // Everything sits inside the box from (3, 3) to (13, 13). Each object but the hero grants
  // `move`, which a player seat has, so `canSelect` turns it away only for its own reason.
  const create = (entity: Record<string, unknown>) =>
    ok(host.intent('entity.create', { sceneId: SCENE, entity }));
  // A 6-cell battlemap centred on (8, 8): the player's focus is never the Map layer.
  await create({
    id: MAP,
    layer: 'map',
    name: 'Player marquee map',
    owners: [],
    perms: { move: true },
    transform: transform(8, 8, 6),
    image: { asset: { source: 'local', hash: 'd'.repeat(64), kind: 'image' }, calibrated: true },
  });
  await create({
    id: HERO,
    layer: 'tokens',
    name: 'Marquee hero',
    owners: [SEAT],
    transform: transform(6.5, 6.5),
    token,
  });
  await create({
    id: DM_TOKEN,
    layer: 'dm',
    name: DM_NAME,
    owners: [],
    perms: { move: true },
    transform: transform(7.5, 9.5),
    token,
  });
  await create({
    id: UNSEEN,
    layer: 'tokens',
    name: UNSEEN_NAME,
    owners: [],
    perms: { view: false, move: true },
    transform: transform(9.5, 6.5),
    token,
  });
  // An AoE that belongs to a co-DM's seat (one AoE per placing identity, so the ids match); the
  // player may not edit or move it.
  const placer = await connectAoEPlacer(table, host, AOE, 2750);
  await ok(
    placer.intent('aoe.place', {
      sceneId: SCENE,
      entity: {
        id: AOE,
        layer: 'tokens',
        name: 'Co-DM blast',
        owners: [],
        transform: transform(9.5, 8.5),
        aoe: { kind: 'sphere', radius: 1, color: '#ff7744' },
      },
    }),
  );

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(
    ({ identity, seatId }) => {
      localStorage.setItem('mythic.identity.v1', JSON.stringify(identity));
      localStorage.setItem(
        'mythic.profile.v1',
        JSON.stringify({ displayName: 'Hero', lastSeatId: seatId }),
      );
    },
    { identity: PLAYER, seatId: SEAT },
  );
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const frames = recordPageFrames(page);
  await page.goto(table.clientUrl);
  await expect(page.getByRole('status')).toHaveText('Connected to New campaign');
  await expect(page.getByTestId('token-label').filter({ hasText: 'Marquee hero' })).toBeVisible();
  const select = page.getByRole('button', { name: 'Select', exact: true });
  await expect(select).toHaveAttribute('aria-pressed', 'true');
  // The map and the co-DM's AoE are drawn for the player, so the marquee has them to turn away.
  await expect
    .poll(async () => {
      const { objects } = await render(page);
      return [MAP, AOE, HERO].every((id) => objects.includes(id));
    })
    .toBe(true);

  const box = await stableBoardLayout(page);
  // Default 40x30 scene, framed whole: one cell per scene unit, centred on (20, 15).
  const zoom = fitZoom(box);
  const screen = (x: number, z: number) => ({
    x: box.x + box.width / 2 + (x - 20) * zoom,
    y: box.y + box.height / 2 + (z - 15) * zoom,
  });
  const drag = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await expect(page.getByTestId('selection-marquee')).toBeVisible();
    await page.mouse.up();
    await expect(page.getByTestId('selection-marquee')).toHaveCount(0);
  };

  await test.step('a plain marquee selects the hero alone', async () => {
    await drag(screen(3, 3), screen(13, 13));
    await expect.poll(async () => (await render(page)).selection).toEqual([HERO]);
  });

  await test.step('an additive marquee adds nothing hidden or unselectable', async () => {
    await page.keyboard.down('Shift');
    await drag(screen(13, 13), screen(3, 3));
    await page.keyboard.up('Shift');
    await expect.poll(async () => (await render(page)).selection).toEqual([HERO]);
  });

  // The hidden objects never reached the player at all (PERM-03).
  const text = (await page.locator('html').textContent()) ?? '';
  expect(text).not.toContain(DM_NAME);
  expect(text).not.toContain(UNSEEN_NAME);
  const wire = frames.join('\n');
  expect(wire).not.toContain(DM_TOKEN);
  expect(wire).not.toContain(UNSEEN);

  expect(errors).toEqual([]);
  await placer.close();
  await host.close();
  await context.close();
});
