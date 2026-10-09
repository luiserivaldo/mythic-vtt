import { expect, test, type Page } from '@playwright/test';
import {
  RawClient,
  recordPageFrames,
  seedProfile,
  startTable,
  testUlid,
  type Table,
} from './harness.js';

// M1-41 (MEAS-01/02): quick rulers clear on release, Persistent rulers remain one-per-sender, and
// the idle tool yields token clicks back to selection. Everything is ephemeral and nothing is logged.

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
  const token = testUlid('TOKEN', 1);
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
  await setup.intent('entity.create', {
    sceneId: scene,
    entity: {
      id: token,
      layer: 'tokens',
      name: 'Ruler target',
      owners: [],
      transform: {
        position: { x: 15.5, y: 0, z: 12.5 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
      },
      token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
    },
  });

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
  const frames = recordPageFrames(player);
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
  const tokenAt = at(15.5, 12.5);

  await dm.getByRole('button', { name: 'Ruler', exact: true }).click();
  await expect(dm.getByRole('button', { name: 'Ruler', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await dm.mouse.move(a.x, a.y);
  await dm.mouse.down();
  await dm.mouse.move(b.x, b.y, { steps: 5 });
  await expect(dm.getByTestId('ruler-total')).toHaveText('30 ft');
  await expect(player.getByTestId('remote-ruler-total')).toHaveText('DM: 30 ft');
  await dm.mouse.up();
  await expect(dm.getByTestId('ruler-total')).toHaveCount(0);
  await expect(player.getByTestId('remote-ruler-total')).toHaveCount(0);

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

  // Persistent rulers remain after release, and each sender has one independent slot.
  await dm.getByLabel('Ruler fade').selectOption('linger');
  await dm.mouse.move(a.x, a.y);
  await dm.mouse.down();
  await dm.mouse.move(b.x, b.y, { steps: 5 });
  await dm.mouse.up();
  await expect(dm.getByTestId('ruler-total')).toHaveText('30 ft');
  await expect(player.getByTestId('remote-ruler-total')).toHaveText('DM: 30 ft');

  await player.keyboard.press('r');
  await player.getByLabel('Ruler fade').selectOption('linger');
  const playerAt = await cellToPixel(player);
  const playerA = playerAt(5.5, 5.5);
  const playerB = playerAt(11.5, 5.5);
  await player.mouse.move(playerA.x, playerA.y);
  await player.mouse.down();
  await player.mouse.move(playerB.x, playerB.y, { steps: 5 });
  await player.mouse.up();
  await expect(player.getByTestId('ruler-total')).toHaveText('30 ft');
  await expect(dm.getByTestId('remote-ruler-total')).toHaveText('Aria: 30 ft');
  await expect(player.getByTestId('remote-ruler-total')).toHaveText('DM: 30 ft');

  // A replacement changes only the DM's slot; Aria's ruler remains visible.
  await dm.mouse.move(a.x, a.y);
  await dm.mouse.down();
  await dm.mouse.move(c.x, c.y, { steps: 5 });
  await dm.mouse.up();
  await expect(dm.getByTestId('ruler-total')).toHaveText('35 ft');
  await expect(dm.getByTestId('remote-ruler-total')).toHaveText('Aria: 30 ft');

  // Turning broadcast off cancels the public ruler and keeps a new measure local.
  await dm.getByLabel('Broadcast to others').uncheck();
  await expect(player.getByTestId('remote-ruler-total')).toHaveCount(0);
  const privateStart = frames.length;
  await dm.mouse.move(a.x, a.y);
  await dm.mouse.down();
  await dm.mouse.move(b.x, b.y, { steps: 5 });
  await dm.mouse.up();
  await expect(dm.getByTestId('ruler-total')).toHaveText('30 ft');
  expect(
    frames.slice(privateStart).filter((raw) => {
      const frame = JSON.parse(raw) as {
        channel?: string;
        from?: string;
        data?: { phase?: string };
      };
      return (
        frame.channel === 'ruler.preview' &&
        frame.from === HOST.identityId &&
        frame.data?.phase !== 'cancelled'
      );
    }),
  ).toEqual([]);

  // Right click clears only this user's ruler and leaves the tool armed.
  await dm.mouse.click(c.x, c.y, { button: 'right' });
  await expect(dm.getByTestId('ruler-total')).toHaveCount(0);
  await expect(dm.getByTestId('remote-ruler-total')).toHaveText('Aria: 30 ft');
  await expect(player.getByTestId('remote-ruler-total')).toHaveCount(0);
  await expect(dm.getByRole('button', { name: 'Ruler', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // A short token click while idle exits the tool, then the normal selection click opens Transform.
  await dm.mouse.click(tokenAt.x, tokenAt.y);
  await expect(dm.getByRole('button', { name: 'Ruler', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(dm.getByRole('region', { name: 'Transform: Ruler target' })).toBeVisible();

  expect(errors).toEqual([]);
  await setup.close();
  await dmContext.close();
  await playerContext.close();
});
