import { expect, test, type Page } from '@playwright/test';
import { RawClient, seedProfile, startTable, testUlid, type Table } from './harness.js';

// M1-21 (MEAS-01): the 2D ruler measures with the scene's units, finishes on double-click, and is
// shared live through the ephemeral relay with the sender's seat name. Nothing is logged.

let table: Table;

test.beforeAll(async () => {
  table = await startTable();
});

test.afterAll(async () => {
  await table.stop();
});

const HOST = { identityId: testUlid('HOST', 1), identitySecret: 'host-secret' };
const PLAYER = { identityId: testUlid('PLAYER', 1), identitySecret: 'player-secret' };

async function cellToPixel(page: Page) {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas box');
  const zoom = Math.min(box.width / 42, box.height / 32);
  return (x: number, z: number) => ({
    x: box.x + box.width / 2 + (x - 20) * zoom,
    y: box.y + box.height / 2 + (z - 15) * zoom,
  });
}

test('the ruler measures in scene units and a second client sees it with the sender name', async ({
  browser,
}) => {
  const scene = testUlid('SCENE', 1);
  const seat = testUlid('SEAT', 1);
  const setup = await RawClient.connect(table, {
    name: 'host',
    ...HOST,
    hostToken: table.hostToken,
  });
  await setup.waitFor('snapshot', () => setup.state !== undefined);
  await setup.intent('scene.create', { sceneId: scene, name: 'Crypt' });
  await setup.intent('scene.activate', { sceneId: scene });
  await setup.intent('seat.create', { seatId: seat, label: 'Aria' });
  await setup.intent('seat.assign', { seatId: seat, identityId: PLAYER.identityId });

  const dmContext = await browser.newContext();
  await dmContext.addInitScript((identity) => {
    localStorage.setItem('mythic.identity.v1', JSON.stringify(identity));
    localStorage.setItem('mythic.host', '1');
  }, HOST);
  await seedProfile(dmContext, 'dm');
  const dm = await dmContext.newPage();
  const playerContext = await browser.newContext();
  await playerContext.addInitScript((identity) => {
    localStorage.setItem('mythic.identity.v1', JSON.stringify(identity));
  }, PLAYER);
  await seedProfile(playerContext, 'player');
  const player = await playerContext.newPage();
  const errors: string[] = [];
  for (const page of [dm, player]) page.on('pageerror', (e) => errors.push(e.message));
  await dm.goto(table.clientUrl);
  await player.goto(table.clientUrl);
  await expect(dm.locator('canvas')).toBeVisible();
  await expect(player.locator('canvas')).toBeVisible();

  const at = await cellToPixel(dm);
  const a = at(5.5, 5.5);
  const b = at(11.5, 5.5);
  const c = at(11.5, 8.5);

  await dm.getByRole('button', { name: 'Ruler' }).click();
  await expect(dm.getByRole('button', { name: 'Ruler' })).toHaveAttribute('aria-pressed', 'true');
  await dm.mouse.move(a.x, a.y);
  await dm.mouse.down();
  await dm.mouse.move(b.x, b.y, { steps: 5 });
  await dm.mouse.up();
  await expect(dm.getByTestId('ruler-total')).toHaveText('30 ft');
  // Release finishes a quick measurement, which remains readable until the next press.
  await expect(dm.getByTestId('ruler-total')).toHaveText('30 ft');
  // The second client sees the live ruler, named after the sender (a seatless DM).
  await expect(player.getByTestId('remote-ruler-total')).toHaveText('DM: 30 ft');

  // A short press starts a fresh click-path, then click and double-click build 6 + 3 cells.
  await dm.mouse.click(a.x, a.y);
  await dm.mouse.move(b.x, b.y, { steps: 5 });
  await dm.mouse.click(b.x, b.y);
  await dm.mouse.dblclick(c.x, c.y);
  await expect(dm.getByTestId('ruler-total')).toHaveText('45 ft');
  await expect(dm.getByTestId('ruler-segment')).toHaveText(['30 ft', '15 ft']);
  await expect(player.getByTestId('remote-ruler-total')).toHaveText('DM: 45 ft');

  // Escape cancels and clears it everywhere.
  await dm.keyboard.press('Escape');
  await expect(dm.getByTestId('ruler-total')).toHaveCount(0);
  await expect(player.getByTestId('remote-ruler-total')).toHaveCount(0);

  // The seated player's ruler carries the seat name; Enter finishes it.
  await player.keyboard.press('r');
  await player.mouse.click(a.x, a.y);
  await player.mouse.move(b.x, b.y, { steps: 5 });
  await player.keyboard.press('Enter');
  await expect(player.getByTestId('ruler-total')).toHaveText('30 ft');
  await expect(dm.getByTestId('remote-ruler-total')).toHaveText('Aria: 30 ft');

  expect(errors).toEqual([]);
  await setup.close();
  await dmContext.close();
  await playerContext.close();
});
