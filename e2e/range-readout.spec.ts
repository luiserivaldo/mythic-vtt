import { settledCellToPixel } from './board-map.js';
import { expect, test } from '@playwright/test';
import {
  RawClient,
  openClient,
  recordPageFrames,
  seedProfile,
  settledCameraPose,
  startTable,
  testUlid,
  type CameraPose,
  type Table,
} from './harness.js';

// M4-16 (MEAS-05): with one token selected, hovering another token shows the token-to-token range
// (horizontal, vertical, total) in scene units, in 2D and in 3D. Hovering is local view state: it
// is never broadcast and never logged, and a viewer that cannot select sees no readout.

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
const WYVERN = testUlid('TOKEN', 3);
const WALL = testUlid('PROP', 1);

/** Projects a world point through the live 3D pose (M2-12 default vertical FOV is 60 degrees). */
function projectToCanvas(
  pose: CameraPose,
  box: { x: number; y: number; width: number; height: number },
  point: { x: number; y: number; z: number },
) {
  const sinAzimuth = Math.sin(pose.azimuth);
  const cosAzimuth = Math.cos(pose.azimuth);
  const sinPolar = Math.sin(pose.polar);
  const cosPolar = Math.cos(pose.polar);
  const dx = point.x - pose.targetX;
  const dy = point.y - pose.targetY;
  const dz = point.z - pose.targetZ;
  const cameraX = dx * cosAzimuth - dz * sinAzimuth;
  const cameraY = -dx * cosPolar * sinAzimuth + dy * sinPolar - dz * cosPolar * cosAzimuth;
  const depth =
    pose.distance - (dx * sinPolar * sinAzimuth + dy * cosPolar + dz * sinPolar * cosAzimuth);
  const tanVertical = Math.tan(Math.PI / 6);
  const ndcX = cameraX / (depth * tanVertical * (box.width / box.height));
  const ndcY = cameraY / (depth * tanVertical);
  return {
    x: box.x + ((ndcX + 1) * box.width) / 2,
    y: box.y + ((1 - ndcY) * box.height) / 2,
  };
}

test('the selected token reads the range to a hovered token in 2D and 3D', async ({ browser }) => {
  test.setTimeout(120_000);
  const scene = testUlid('SCENE', 1);
  const setup = await RawClient.connect(table, {
    name: 'host',
    ...HOST,
    hostToken: table.hostToken,
  });
  await setup.waitFor('snapshot', () => setup.state !== undefined);
  await setup.intent('scene.create', { sceneId: scene, name: 'Range test' });
  await setup.intent('scene.activate', { sceneId: scene });

  const token = (id: string, name: string, x: number, y: number, z: number) => ({
    sceneId: scene,
    entity: {
      id,
      layer: 'tokens',
      name,
      owners: [],
      transform: {
        position: { x, y, z },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
      },
      token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
    },
  });
  // Aria is the origin; Ogre is 6 cells away at the same elevation; Wyvern is 6 cells away and
  // 2 cells (10 ft) above it, so the readout has to show a vertical leg.
  await setup.intent('entity.create', token(ARIA, 'Aria', 15.5, 0, 12.5));
  await setup.intent('entity.create', token(OGRE, 'Ogre', 21.5, 0, 12.5));
  await setup.intent('entity.create', token(WYVERN, 'Wyvern', 15.5, 2, 18.5));
  // A prop is a valid hover target for nothing: MEAS-05 is token-to-token.
  await setup.intent('entity.create', {
    sceneId: scene,
    entity: {
      id: WALL,
      layer: 'props',
      name: 'Wall',
      owners: [],
      transform: {
        position: { x: 8.5, y: 0, z: 8.5 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
      },
      shape: { kind: 'box', color: '#556677', walkable: false },
    },
  });

  const dmContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await dmContext.addInitScript((identity) => {
    localStorage.setItem('mythic.identity.v1', JSON.stringify(identity));
    localStorage.setItem('mythic.host', '1');
  }, HOST);
  await seedProfile(dmContext, 'dm');
  const dm = await dmContext.newPage();
  const errors: string[] = [];
  dm.on('pageerror', (error) => errors.push(error.message));
  const frames = recordPageFrames(dm);
  await dm.goto(table.clientUrl);
  await expect(dm.locator('canvas')).toBeVisible();

  // A viewer that cannot select anything shows no readout (PERM-03 filter plus local selection).
  const viewer = await openClient(browser, table, 'viewer');
  viewer.page.on('pageerror', (error) => errors.push(error.message));
  await expect(viewer.page.locator('canvas')).toBeVisible();

  const at = await settledCellToPixel(dm);
  const aria = at(15.5, 12.5);
  const ogre = at(21.5, 12.5);
  const wyvern = at(15.5, 18.5);
  const wall = at(8.5, 8.5);
  const empty = at(2.5, 2.5);

  // Hovering without a selected token shows nothing.
  await dm.mouse.move(ogre.x, ogre.y);
  await expect(dm.getByTestId('range-readout')).toHaveCount(0);

  await dm.mouse.click(aria.x, aria.y);
  // UI-TOKEN-07 / MV-279: the Transform panel opens in the left pane, which floats over the
  // board's left edge and here would cover the hovered tokens; collapse it to its strip.
  const pane = dm.getByRole('complementary', { name: 'Left pane' });
  const transform = pane.getByRole('region', { name: 'Transform: Aria' });
  await expect(transform).toBeVisible();
  await pane.getByRole('button', { name: 'Collapse left pane' }).click();
  await expect(transform).toBeHidden();

  // 2D: H 6 cells (30 ft), no vertical leg.
  await dm.mouse.move(ogre.x, ogre.y);
  await expect(dm.getByTestId('range-readout')).toHaveText('H 30 ft · V 0 ft · T 30 ft');

  // 2D: the elevated token adds a 2-cell (10 ft) vertical leg, which the total includes.
  await dm.mouse.move(wyvern.x, wyvern.y);
  await expect(dm.getByTestId('range-readout')).toHaveText('H 30 ft · V 10 ft · T 35 ft');

  // Hovering the origin itself, a non-token, or empty board shows nothing.
  await dm.mouse.move(aria.x, aria.y);
  await expect(dm.getByTestId('range-readout')).toHaveCount(0);
  await dm.mouse.move(wall.x, wall.y);
  await expect(dm.getByTestId('range-readout')).toHaveCount(0);
  await dm.mouse.move(empty.x, empty.y);
  await expect(dm.getByTestId('range-readout')).toHaveCount(0);

  // Clearing the selection hides the readout even while the pointer keeps hovering the target.
  await dm.mouse.move(ogre.x, ogre.y);
  await expect(dm.getByTestId('range-readout')).toHaveText('H 30 ft · V 0 ft · T 30 ft');
  await dm.keyboard.press('Escape');
  await expect(transform).toHaveCount(0);
  await expect(dm.getByTestId('range-readout')).toHaveCount(0);

  // 3D: the same readout through the standee, projected through the live pose.
  await dm.mouse.click(aria.x, aria.y);
  await expect(transform).toBeVisible();
  await pane.getByRole('button', { name: 'Collapse left pane' }).click();
  await expect(transform).toBeHidden();
  await dm.getByRole('button', { name: '3D view' }).click();
  await expect(dm.getByRole('button', { name: 'Reset view' })).toBeVisible();
  await dm.getByRole('button', { name: 'Reset view' }).click();
  const canvas = dm.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas box');
  const pose = await settledCameraPose(dm);
  // Size-1 tokens stand 1.2 cells tall above a 0.06 base; aim at the middle of that quad.
  const ogreStandee = projectToCanvas(pose, box, { x: 21.5, y: 0.66, z: 12.5 });
  const ariaStandee = projectToCanvas(pose, box, { x: 15.5, y: 0.66, z: 12.5 });
  await dm.mouse.move(ogreStandee.x, ogreStandee.y, { steps: 6 });
  await expect(dm.getByTestId('range-readout')).toHaveText('H 30 ft · V 0 ft · T 30 ft');
  await dm.mouse.move(ariaStandee.x, ariaStandee.y, { steps: 6 });
  await expect(dm.getByTestId('range-readout')).toHaveCount(0);

  // MEAS-05 is a local readout: a viewer that cannot select sees none of it, and — unlike the
  // shared M3-06 ruler — hovering broadcasts no ephemeral at all. CAM-06's camera link streams its
  // own `camera.pose` frames (a heartbeat, plus every DM move), so this ignores that channel and
  // checks that the readout adds no traffic of its own.
  await expect(viewer.page.getByTestId('range-readout')).toHaveCount(0);
  const channels = frames
    .flatMap((raw) => {
      const frame = JSON.parse(raw) as { channel?: unknown };
      return typeof frame.channel === 'string' ? [frame.channel] : [];
    })
    .filter((channel) => channel !== 'camera.pose');
  expect(channels).toEqual([]);
  expect(errors).toEqual([]);

  await viewer.context.close();
  await setup.close();
  await dmContext.close();
});
