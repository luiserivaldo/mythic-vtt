import { expect, test, type Page } from '@playwright/test';
import {
  openClient,
  RawClient,
  recordPageFrames,
  startTable,
  testUlid,
  type Table,
} from './harness.js';

// UX-19 (UI-TOKEN-01): a single click shows the quick preview card near the token — name, the three
// quick fields colour-coded, and the gear that opens the full menu. It follows the token in 2D and
// 3D and keeps its pixel size at every zoom. PERM-03: a value the viewer may not see reads
// "not shared" and never arrives as data, and a name the viewer may not read reads as the neutral
// stand-in — checked in the DOM and in the raw frames.

let table: Table;

test.beforeAll(async () => {
  table = await startTable();
});

test.afterAll(async () => {
  await table.stop();
});

const HOST = { identityId: testUlid('HOST', 1), identitySecret: 'host-secret' };
const ARIA = testUlid('TOKEN', 1);
const OGRE = testUlid('TOKEN', 2);
const SECRET_NAME = 'Secret drake';
const DRAGON = testUlid('TOKEN', 3);
const SEAT = testUlid('SEAT', 1);
const SCENE = testUlid('SCENE', 1);

/** Default 40x30 scene: the board centres on cell (20, 15) at one cell per scene unit. */
async function cellToPixel(page: Page) {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas box');
  const zoom = Math.min(box.width / 42, box.height / 32);
  return (x: number, z: number) => ({
    x: box.x + box.width / 2 + (x - 20) * zoom,
    y: box.y + box.height / 2 + (z - 15) * zoom,
  });
}

/**
 * Clicks a cell until the card appears; the first click can land before the board is laid out.
 * The canvas box is re-read on every attempt: the board mounts before the shell has laid the
 * canvas out, so a box captured once can stay at its 300x150 default for the whole retry loop and
 * every click then misses.
 */
async function selectCell(page: Page, x: number, z: number) {
  await expect(async () => {
    const at = await cellToPixel(page);
    const point = at(x, z);
    await page.mouse.click(point.x, point.y);
    await expect(page.getByTestId('token-preview')).toBeVisible({ timeout: 1000 });
  }).toPass();
}

const valueSpan = (page: Page, field: string) =>
  page.getByTestId(`token-preview-field-${field}`).locator('span').last();

test('the card shows the fields it may, follows the token, and leaks nothing', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const identity = HOST;
  const host = await RawClient.connect(table, {
    name: 'DM',
    ...identity,
    hostToken: table.hostToken,
  });
  await host.waitFor('snapshot', () => host.state !== undefined);
  const ok = (reply: Promise<unknown>) => expect(reply).resolves.toMatchObject({ t: 'ack' });
  await ok(host.intent('scene.create', { sceneId: SCENE, name: 'Preview' }));
  await ok(host.intent('scene.activate', { sceneId: SCENE }));
  await ok(host.intent('seat.create', { seatId: SEAT, label: 'Owner' }));

  const transform = (x: number, z: number) => ({
    position: { x, y: 0, z },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  });
  // Aria: the owner's token, with one field per sharing mode and a colour per field.
  await ok(
    host.intent('entity.create', {
      sceneId: SCENE,
      entity: {
        id: ARIA,
        layer: 'tokens',
        name: 'Aria',
        owners: [SEAT],
        transform: transform(15.5, 12.5),
        token: {
          sizeCells: 1,
          heightCells: 1,
          labelVisibility: 'all',
          quickFields: {
            hp: { value: 817263, visibility: 'owner', color: '#ffd166' },
            ac: { value: 918274, visibility: 'dm', color: '#7dd3fc' },
            speed: { value: 6, visibility: 'all' },
          },
        },
      },
    }),
  );
  // Ogre: no quick fields at all, so every row has to read "not shared".
  await ok(
    host.intent('entity.create', {
      sceneId: SCENE,
      entity: {
        id: OGRE,
        layer: 'tokens',
        name: 'Ogre',
        owners: [],
        transform: transform(21.5, 12.5),
        token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
      },
    }),
  );
  // Dragon: an owner-only name the player may not read, but may still select and move.
  await ok(
    host.intent('entity.create', {
      sceneId: SCENE,
      entity: {
        id: DRAGON,
        layer: 'tokens',
        name: SECRET_NAME,
        owners: [],
        perms: { move: true },
        transform: transform(8.5, 12.5),
        token: {
          sizeCells: 1,
          heightCells: 1,
          labelVisibility: 'owner',
          quickFields: { hp: { value: 111, visibility: 'all' } },
        },
      },
    }),
  );

  const dmContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await dmContext.addInitScript((value) => {
    localStorage.setItem('mythic.identity.v1', JSON.stringify(value));
    localStorage.setItem('mythic.host', '1');
  }, identity);
  const dm = await dmContext.newPage();
  const errors: string[] = [];
  dm.on('pageerror', (error) => errors.push(error.message));
  await dm.goto(table.clientUrl);
  await expect(dm.locator('canvas')).toBeVisible();
  await expect(dm.getByRole('status')).toHaveText('Connected to New campaign');
  await expect(dm.getByTestId('token-label')).toHaveCount(3);

  // --- 2D: the card's contents -------------------------------------------------------------
  await selectCell(dm, 15.5, 12.5);
  const card = dm.getByTestId('token-preview');
  await expect(dm.getByTestId('token-preview-name')).toHaveText('Aria');
  await expect(card.getByTestId('token-preview-field-hp')).toContainText('HP');
  await expect(card.getByTestId('token-preview-field-hp')).toContainText('817263');
  await expect(card.getByTestId('token-preview-field-ac')).toContainText('918274');
  // Speed is a scene-units field: 6 cells at 5 ft per cell.
  await expect(card.getByTestId('token-preview-field-speed')).toContainText('30 ft');
  await expect(card.getByTestId('token-preview-field-speed')).toContainText('Speed');
  // Colour-coded values (the field's own colour, readable on the card).
  await expect(valueSpan(dm, 'hp')).toHaveCSS('color', 'rgb(255, 209, 102)');
  await expect(valueSpan(dm, 'ac')).toHaveCSS('color', 'rgb(125, 211, 252)');

  // The gear is a real control that opens the full menu (UI-TOKEN-02) without losing the card.
  const gear = card.getByRole('button', { name: 'Token menu' });
  await expect(gear).toHaveAttribute('aria-haspopup', 'menu');
  await gear.click();
  await expect(card).toBeVisible();

  // The card must not swallow board pointers: hovering another token still reaches the board.
  const at = await cellToPixel(dm);
  await dm.mouse.move(at(21.5, 12.5).x, at(21.5, 12.5).y);
  await expect(dm.getByTestId('range-readout')).toHaveCount(1);

  // A second token (shift-click) makes the selection ambiguous: no card.
  await dm.keyboard.down('Shift');
  await dm.mouse.click(at(21.5, 12.5).x, at(21.5, 12.5).y);
  await dm.keyboard.up('Shift');
  await expect(card).toHaveCount(0);
  await dm.keyboard.press('Escape');
  await expect(card).toHaveCount(0);

  // A token with no quick fields shows three "not shared" rows.
  await selectCell(dm, 21.5, 12.5);
  await expect(dm.getByTestId('token-preview-name')).toHaveText('Ogre');
  await expect(card.locator('li')).toHaveCount(3);
  await expect(card.locator('li').filter({ hasText: 'not shared' })).toHaveCount(3);

  // The DM reads the owner-only name; the player below gets the stand-in for the same token.
  await selectCell(dm, 8.5, 12.5);
  await expect(dm.getByTestId('token-preview-name')).toHaveText(SECRET_NAME);

  // --- 2D: the card follows and stays readable ---------------------------------------------
  await selectCell(dm, 15.5, 12.5);
  const before = await card.boundingBox();
  const canvas = await dm.locator('canvas').boundingBox();
  if (!canvas) throw new Error('no canvas box');
  // Zoom out with the pointer away from the card's gear (the only part of it that takes pointers).
  await dm.mouse.move(canvas.x + 40, canvas.y + 40);
  await dm.mouse.wheel(0, 400);
  await expect(card).toBeVisible();
  await expect.poll(async () => (await card.boundingBox())?.x).not.toBe(before?.x);
  // Readable at all zooms: screen-space HTML, so the font never scales with the camera.
  await expect(card).toHaveCSS('font-size', '13px');

  // --- 3D: the same card, still following the token ---------------------------------------
  await dm.getByRole('button', { name: '3D view' }).click();
  await expect(dm.getByRole('button', { name: 'Reset view' })).toBeVisible();
  await expect(card).toBeVisible();
  await expect(dm.getByTestId('token-preview-name')).toHaveText('Aria');
  const posed = await card.boundingBox();
  // Middle-drag pans the 3D camera: the card has to move with the token, not stay at a screen spot.
  await dm.mouse.move(canvas.x + 60, canvas.y + canvas.height - 60);
  await dm.mouse.down({ button: 'middle' });
  await dm.mouse.move(canvas.x + 260, canvas.y + canvas.height - 100, { steps: 8 });
  await dm.mouse.up({ button: 'middle' });
  await expect(card).toBeVisible();
  await expect
    .poll(async () => {
      const box = await card.boundingBox();
      return box ? Math.abs(box.x - (posed?.x ?? 0)) : 0;
    })
    .toBeGreaterThan(5);

  // --- a player who owns the token: the fields they may see, nothing they may not ---------
  const playerIdentity = { identityId: testUlid('PLAYER', 1), identitySecret: 'preview-player' };
  await ok(host.intent('seat.assign', { seatId: SEAT, identityId: playerIdentity.identityId }));
  const playerContext = await browser.newContext();
  await playerContext.addInitScript(
    ({ identity: who, seatId }) => {
      localStorage.setItem('mythic.identity.v1', JSON.stringify(who));
      localStorage.setItem(
        'mythic.profile.v1',
        JSON.stringify({ displayName: 'Owner', lastSeatId: seatId }),
      );
    },
    { identity: playerIdentity, seatId: SEAT },
  );
  const player = await playerContext.newPage();
  const playerErrors: string[] = [];
  player.on('pageerror', (error) => playerErrors.push(error.message));
  const playerFrames = recordPageFrames(player);
  await player.goto(table.clientUrl);
  await expect(player.getByRole('status')).toHaveText('Connected to New campaign');

  await selectCell(player, 15.5, 12.5);
  const playerCard = player.getByTestId('token-preview');
  await expect(player.getByTestId('token-preview-name')).toHaveText('Aria');
  await expect(playerCard.getByTestId('token-preview-field-hp')).toContainText('817263');
  await expect(playerCard.getByTestId('token-preview-field-ac')).toContainText('not shared');
  await expect(playerCard.getByTestId('token-preview-field-speed')).toContainText('30 ft');

  // A name this player may not read reads as the neutral stand-in, never as the name.
  await selectCell(player, 8.5, 12.5);
  await expect(player.getByTestId('token-preview-name')).toHaveText('Unknown token');
  await expect(player.getByTestId('token-preview-name')).not.toHaveText(SECRET_NAME);

  // PERM-03: the DM-only value and the owner-only name are nowhere in this viewer's page or wire.
  const playerText = (await player.locator('html').textContent()) ?? '';
  expect(playerText).not.toContain('918274');
  expect(playerText).not.toContain(SECRET_NAME);
  await player.waitForTimeout(200);
  expect(playerFrames.join('\n')).not.toMatch(/918274|Secret drake/);

  // --- a spectator: cannot select at all, so no card and no field data ---------------------
  const spectator = await openClient(browser, table, 'viewer');
  const spectatorFrames = recordPageFrames(spectator.page);
  await spectator.page.reload();
  await expect(spectator.page.locator('canvas')).toBeVisible();
  const spectatorAt = await cellToPixel(spectator.page);
  await spectator.page.mouse.click(spectatorAt(15.5, 12.5).x, spectatorAt(15.5, 12.5).y);
  await expect(spectator.page.getByTestId('token-preview')).toHaveCount(0);
  await spectator.page.waitForTimeout(200);
  expect(spectatorFrames.join('\n')).not.toMatch(/817263|918274|Secret drake/);

  expect(errors).toEqual([]);
  expect(playerErrors).toEqual([]);
  await spectator.context.close();
  await playerContext.close();
  await host.close();
  await dmContext.close();
});
