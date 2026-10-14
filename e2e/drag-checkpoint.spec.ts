import { expect, test, type Browser } from '@playwright/test';
import { RawClient, startTable, testUlid, type Table } from './harness.js';

// UX-21 (UI-TOKEN-06, MEAS-01/Q31, §10 C4): while a token is dragged with "Always measure token
// movement" on, a RIGHT click commits a checkpoint and the drag keeps measuring from it,
// cumulatively in scene units with the diagonal rule, in 2D and 3D. The ruler tool keeps its own
// right-click waypoints. The right press belongs to the drag, so it must not orbit the 3D camera,
// start a ruler action or open a context menu, and the right release must leave the drag running.

let table: Table | undefined;

// The host identity is claimed once through the one-time DM token, then reused by every client:
// the gateway keeps recognising this identity as host.
const HOST = { identityId: testUlid('HOST', 21), identitySecret: 'ux-21-host-secret' };

test.beforeAll(async () => {
  table = await startTable();
  const bootstrap = await RawClient.connect(table, {
    name: 'ux-21 bootstrap',
    ...HOST,
    hostToken: table.hostToken,
  });
  await bootstrap.waitFor('host snapshot', () => bootstrap.state !== undefined);
  await bootstrap.close();
});

test.afterAll(async () => {
  await table?.stop();
});

interface Snapshot {
  scenes: Record<
    string,
    { entities: Record<string, { transform: { position: { x: number; y: number; z: number } } }> }
  >;
}

interface CameraPose {
  targetX: number;
  targetY: number;
  targetZ: number;
  azimuth: number;
  polar: number;
  distance: number;
}

/** A DM page: the reused host identity plus the remembered host hint (the token is spent). */
async function openHostPage(browser: Browser, query = '') {
  if (!table) throw new Error('table not started');
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript((identity) => {
    localStorage.setItem('mythic.identity.v1', JSON.stringify(identity));
    localStorage.setItem('mythic.host', '1');
  }, HOST);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${table.clientUrl.replace(/\/$/, '')}/${query}`);
  await expect(page.getByRole('status')).toHaveText('Connected to New campaign');
  return { context, page, errors };
}

/** One scene with one token, created through the wire so the drag target is unambiguous. */
async function sceneWithToken(
  sceneId: string,
  tokenId: string,
  name: string,
  at: { x: number; z: number },
): Promise<RawClient> {
  if (!table) throw new Error('table not started');
  const host = await RawClient.connect(table, { name: `${name} host`, ...HOST });
  await host.waitFor('host snapshot', () => host.state !== undefined);
  expect((await host.intent('scene.create', { sceneId, name })).t).toBe('ack');
  expect((await host.intent('scene.activate', { sceneId })).t).toBe('ack');
  const created = await host.intent('entity.create', {
    sceneId,
    entity: {
      id: tokenId,
      layer: 'tokens',
      name: 'Goblin',
      owners: [],
      transform: {
        position: { x: at.x, y: 0, z: at.z },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
      },
      token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
    },
  });
  expect(created.t, created.reason ?? '').toBe('ack');
  return host;
}

test('a right click while dragging a token commits a 2D checkpoint and the total stays cumulative', async ({
  browser,
}, testInfo) => {
  const sceneId = testUlid('SCENE', 31);
  const tokenId = testUlid('TOKEN', 31);
  const { context, page, errors } = await openHostPage(browser);
  const host = await sceneWithToken(sceneId, tokenId, 'Checkpoints', { x: 5.5, z: 5.5 });

  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId('token-label')).toHaveText('Goblin');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas box');
  const zoom = Math.min(box.width / 42, box.height / 32);
  const at = (x: number, z: number) => ({
    x: box.x + box.width / 2 + (x - 20) * zoom,
    y: box.y + box.height / 2 + (z - 15) * zoom,
  });

  const start = at(5.5, 5.5);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const east = at(8.5, 5.5);
  await page.mouse.move(east.x, east.y, { steps: 6 });
  await expect(page.getByTestId('drag-ruler-total')).toHaveText('15 ft');

  // The RIGHT press commits a checkpoint at the live position; the release that follows carries the
  // same pointer id, so it must leave the drag (and its ruler) running. A left press never does.
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  await expect(page.getByTestId('drag-ruler-total')).toHaveText('15 ft');

  const south = at(8.5, 8.5);
  await page.mouse.move(south.x, south.y, { steps: 6 });
  // Three cells east then three cells south: two 15 ft legs, not the 15 ft straight line.
  await expect(page.getByTestId('drag-ruler-segment')).toHaveText(['15 ft', '15 ft']);
  await expect(page.getByTestId('drag-ruler-total')).toHaveText('30 ft');
  await page.screenshot({ path: testInfo.outputPath('drag-checkpoint-2d.png') });

  await page.mouse.up();
  await expect(page.getByTestId('drag-ruler-total')).toHaveCount(0);

  const position = () =>
    (host.state as Snapshot).scenes[sceneId]?.entities[tokenId]?.transform.position;
  await expect.poll(() => position()?.x, { timeout: 10_000 }).toBeCloseTo(8.5);
  expect(position()?.z).toBeCloseTo(8.5);
  expect(position()?.y).toBe(0);
  expect(errors).toEqual([]);

  await host.close();
  await context.close();
});

test('a right click while dragging a token checkpoints in 3D without orbiting the camera', async ({
  browser,
}, testInfo) => {
  test.setTimeout(60_000);
  const sceneId = testUlid('SCENE', 32);
  const tokenId = testUlid('TOKEN', 32);
  const { context, page, errors } = await openHostPage(browser, '?camera=3d');
  // The default 3D view looks at the canvas centre, so the token sits on the canvas centre.
  const host = await sceneWithToken(sceneId, tokenId, 'Checkpoints 3D', { x: 20, z: 15 });

  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId('token-label')).toHaveText('Goblin');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas box');
  const readPose = () =>
    page.evaluate(
      () =>
        (
          globalThis as unknown as { __mythicCamera?: { getPose(): CameraPose } }
        ).__mythicCamera?.getPose() ?? null,
    );
  await expect.poll(readPose).not.toBeNull();
  const before = await readPose();

  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // The token stands on the focus, so just above the canvas centre grabs its feet.
  const grab = { x: centre.x, y: centre.y - 10 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + 80, grab.y, { steps: 6 });
  await expect(page.getByTestId('drag-ruler-total')).toHaveCount(1);

  // Right-drag orbits in 3D: this press must not move the camera, and its release must not end the
  // drag either.
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  expect(await readPose()).toEqual(before);
  await expect(page.getByTestId('drag-ruler-total')).toHaveCount(1);

  await page.mouse.move(grab.x + 80, grab.y + 40, { steps: 6 });
  // Base, checkpoint, live position: two legs, so the checkpoint was committed.
  await expect(page.getByTestId('drag-ruler-segment')).toHaveCount(2);
  await page.screenshot({ path: testInfo.outputPath('drag-checkpoint-3d.png') });

  await page.mouse.up();
  await expect(page.getByTestId('drag-ruler-total')).toHaveCount(0);

  const position = () =>
    (host.state as Snapshot).scenes[sceneId]?.entities[tokenId]?.transform.position;
  await expect.poll(() => position()?.x, { timeout: 10_000 }).not.toBeCloseTo(20, 3);
  // Snapped to a cell centre (odd half-cell) and still on the ground.
  const landed = position();
  expect((landed?.x ?? 0) * 2).toBeCloseTo(Math.round((landed?.x ?? 0) * 2), 6);
  expect(landed?.y).toBe(0);
  expect(errors).toEqual([]);

  await host.close();
  await context.close();
});
