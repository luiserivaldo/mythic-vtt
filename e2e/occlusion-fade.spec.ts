import { expect, test } from '@playwright/test';
import {
  PERFORMANCE_SCENE,
  withinRenderBudget,
} from '../packages/client/src/render/performance-budget.js';
import { orbitPosition, type Orbit3D } from '../packages/client/src/render/camera-3d.js';
import { RawClient, openClient, startTable, testUlid, type Table } from './harness.js';

interface Diagnostics {
  __mythicCamera?: { getPose(): Readonly<Orbit3D> };
  __mythicOcclusion?: { getMaterials(): { id: string; opacity: number; depthWrite: boolean }[] };
  __mythicRender?: {
    getFrameCount(): number;
    getRenderInfo(): { calls: number; triangles: number };
  };
}

let table: Table | undefined;
test.beforeAll(async () => {
  table = await startTable();
});
test.afterAll(async () => {
  await table?.stop();
});

test('selected tokens fade blocking primitives locally in 3D and restore materials in 2D', async ({
  browser,
}) => {
  if (!table) throw new Error('table not started');
  const identity = { identityId: testUlid('HOST', 1), identitySecret: 'occlusion-test-host' };
  const setup = await RawClient.connect(table, {
    name: 'DM',
    ...identity,
    hostToken: table.hostToken,
  });
  const sceneId = testUlid('SCENE', 1);
  const tokenId = testUlid('TOKEN', 1);
  const wallId = testUlid('WALL', 1);
  expect(await setup.intent('scene.create', { sceneId, name: 'Occlusion' })).toMatchObject({
    t: 'ack',
  });
  expect(await setup.intent('scene.activate', { sceneId })).toMatchObject({ t: 'ack' });
  expect(
    await setup.intent('entity.create', {
      sceneId,
      entity: {
        id: tokenId,
        layer: 'tokens',
        name: 'Focus token',
        owners: [],
        transform: {
          position: { x: 20, y: 0, z: 15 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          scale: { x: 1, y: 1, z: 1 },
        },
        token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
      },
    }),
  ).toMatchObject({ t: 'ack' });
  // Keep the render-budget fixture independent of the known AoE setup defect (MV-183).
  const population = [];
  for (
    let index = 0;
    index < Math.max(PERFORMANCE_SCENE.tokens, PERFORMANCE_SCENE.props);
    index++
  ) {
    for (const kind of ['token', 'prop'] as const) {
      population.push(
        setup.intent('entity.create', {
          sceneId,
          entity: {
            id: testUlid(kind === 'token' ? 'LOADTOKEN' : 'LOADPROP', index),
            layer: kind === 'token' ? 'tokens' : 'props',
            name: `Budget ${kind} ${String(index)}`,
            owners: [],
            transform: {
              position: { x: (index % 10) * 3 + 2, y: 0, z: Math.floor(index / 10) * 2 + 2 },
              rotation: { x: 0, y: 0, z: 0, w: 1 },
              scale: { x: 1, y: 1, z: 1 },
            },
            ...(kind === 'token'
              ? { token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' } }
              : { shape: { kind: 'box', color: '#667788', walkable: false } }),
          },
        }),
      );
    }
  }
  for (const reply of await Promise.all(population)) expect(reply.t).toBe('ack');
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript((value) => {
    localStorage.setItem('mythic.identity.v1', JSON.stringify(value));
    localStorage.setItem('mythic.host', '1');
  }, identity);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(table.clientUrl);
  await expect(page.getByRole('status')).toHaveText('Connected to New campaign');
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page.getByRole('button', { name: 'Focus token', exact: true }).click();
  await page.getByRole('button', { name: '3D view' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (globalThis as unknown as Diagnostics).__mythicCamera?.getPose()),
    )
    .not.toBeUndefined();
  const pose = await page.evaluate(() =>
    (globalThis as unknown as Diagnostics).__mythicCamera?.getPose(),
  );
  if (!pose) throw new Error('camera diagnostics unavailable');
  const camera = orbitPosition(pose);
  const point = { x: (camera.x + 20) / 2, y: (camera.y + 0.6) / 2 - 2, z: (camera.z + 15) / 2 };
  expect(
    await setup.intent('entity.create', {
      sceneId,
      entity: {
        id: wallId,
        layer: 'props',
        name: 'Blocking wall',
        owners: [],
        transform: {
          position: point,
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          scale: { x: 5, y: 5, z: 5 },
        },
        shape: { kind: 'box', color: '#997744', walkable: false },
      },
    }),
  ).toMatchObject({ t: 'ack' });
  const opacity = () =>
    page.evaluate(
      (id) =>
        (globalThis as unknown as Diagnostics).__mythicOcclusion
          ?.getMaterials()
          .find((entry) => entry.id === id)?.opacity,
      wallId,
    );
  await expect.poll(opacity).toBe(0.18);
  const viewer = await openClient(browser, table, 'viewer');
  await viewer.page.getByRole('button', { name: '3D view' }).click();
  await expect
    .poll(() =>
      viewer.page.evaluate(
        (id) =>
          (globalThis as unknown as Diagnostics).__mythicOcclusion
            ?.getMaterials()
            .find((entry) => entry.id === id)?.opacity,
        wallId,
      ),
    )
    .toBe(1);
  const canvas = await page.locator('canvas').boundingBox();
  if (!canvas) throw new Error('canvas unavailable');
  const centerX = canvas.x + canvas.width / 2;
  const centerY = canvas.y + canvas.height / 2;
  await page.mouse.move(centerX, centerY);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(centerX + 400, centerY, { steps: 8 });
  await page.mouse.up({ button: 'right' });
  await expect.poll(opacity).toBe(1);
  await page.getByRole('button', { name: 'Reset view' }).click();
  await expect.poll(opacity).toBe(0.18);
  await expect(page.getByTestId('token-label').filter({ hasText: 'Focus token' })).toContainText(
    'Focus token',
  );
  let previous = -1;
  await expect
    .poll(async () => {
      const current = await page.evaluate(
        () => (globalThis as unknown as Diagnostics).__mythicRender?.getFrameCount() ?? -1,
      );
      const stable = current >= 0 && current === previous;
      previous = current;
      return stable;
    })
    .toBe(true);
  const idleFrames = previous;
  const info = await page.evaluate(() =>
    (globalThis as unknown as Diagnostics).__mythicRender?.getRenderInfo(),
  );
  if (!info) throw new Error('render diagnostics unavailable');
  expect(withinRenderBudget(info)).toBe(true);
  // Repeated polls observe demand rendering without scheduling extra frames.
  for (let sample = 0; sample < 3; sample++)
    expect(
      await page.evaluate(() =>
        (globalThis as unknown as Diagnostics).__mythicRender?.getFrameCount(),
      ),
    ).toBe(idleFrames);
  await page.getByRole('button', { name: 'Blocking wall', exact: true }).click();
  await expect.poll(opacity).toBe(1);
  await page.getByRole('button', { name: 'Focus token', exact: true }).click();
  await expect.poll(opacity).toBe(0.18);
  await page.getByRole('button', { name: '3D view' }).click();
  await expect(page.getByRole('button', { name: 'Reset view' })).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => (globalThis as unknown as Diagnostics).__mythicOcclusion === undefined),
    )
    .toBe(true);
  await expect(page.getByTestId('token-label').filter({ hasText: 'Focus token' })).toContainText(
    'Focus token',
  );
  expect(errors).toEqual([]);
  await viewer.context.close();
  await context.close();
  await setup.close();
});
