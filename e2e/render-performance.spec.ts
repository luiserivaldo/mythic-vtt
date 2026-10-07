import { expect, test, type Page } from '@playwright/test';
import {
  PERFORMANCE_SCENE,
  RENDER_BUDGET,
} from '../packages/client/src/render/performance-budget.js';
import { openClient, RawClient, startTable, testUlid, type Table } from './harness.js';

interface RenderInfo {
  calls: number;
  triangles: number;
  lines: number;
  points: number;
}

interface BrowserDiagnostics {
  __mythicRender?: {
    getFrameCount(): number;
    getRenderInfo(): RenderInfo;
  };
}

const transform = (x: number, y: number, z: number) => ({
  position: { x, y, z },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: 1, y: 1, z: 1 },
});

async function waitForIdle(page: Page): Promise<number> {
  let previous = -1;
  await expect
    .poll(async () => {
      const current = await page.evaluate(
        () => (globalThis as unknown as BrowserDiagnostics).__mythicRender?.getFrameCount() ?? -1,
      );
      const stable = current >= 0 && current === previous;
      previous = current;
      return stable;
    })
    .toBe(true);
  return previous;
}

async function assertIdleForOneSecond(page: Page): Promise<void> {
  const before = await waitForIdle(page);
  await page.waitForTimeout(1_000);
  expect(
    await page.evaluate(() =>
      (globalThis as unknown as BrowserDiagnostics).__mythicRender?.getFrameCount(),
    ),
  ).toBe(before);
}

async function renderInfo(page: Page): Promise<RenderInfo> {
  const info = await page.evaluate(() =>
    (globalThis as unknown as BrowserDiagnostics).__mythicRender?.getRenderInfo(),
  );
  if (!info) throw new Error('render diagnostics unavailable');
  return info;
}

let table: Table;
let host: RawClient;

test.beforeAll(async () => {
  table = await startTable();
  host = await RawClient.connect(table, {
    name: 'performance-host',
    identityId: testUlid('HOST', 10),
    identitySecret: 'performance-host-secret',
    hostToken: table.hostToken,
  });
  await host.waitFor('host snapshot', () => host.state !== undefined);
  const sceneId = testUlid('SCENE', 10);
  expect(await host.intent('scene.create', { sceneId, name: 'Performance budget' })).toMatchObject({
    t: 'ack',
  });
  expect(await host.intent('scene.activate', { sceneId })).toMatchObject({ t: 'ack' });

  const intents: Promise<{ t: 'ack' | 'reject' }>[] = [];
  for (let index = 0; index < PERFORMANCE_SCENE.tokens; index++) {
    intents.push(
      host.intent('entity.create', {
        sceneId,
        entity: {
          id: testUlid('TOKENPERF', index),
          layer: 'tokens',
          name: `Token ${String(index)}`,
          owners: [],
          transform: transform(
            (index % 20) + 0.5,
            index % 4 === 0 ? 1 : 0,
            Math.floor(index / 20) + 0.5,
          ),
          token: {
            sizeCells: 1,
            heightCells: 1,
            color: index % 2 === 0 ? '#b96545' : '#4f79a8',
            labelVisibility: 'all',
          },
        },
      }),
    );
  }
  const kinds = ['box', 'cylinder', 'cone', 'pyramid', 'sphere', 'plane', 'wedge'] as const;
  for (let index = 0; index < PERFORMANCE_SCENE.props; index++) {
    intents.push(
      host.intent('entity.create', {
        sceneId,
        entity: {
          id: testUlid('PROPPERF', index),
          layer: 'props',
          name: `Prop ${String(index)}`,
          owners: [],
          transform: transform((index % 20) + 0.5, 0, Math.floor(index / 20) + 8.5),
          shape: {
            kind: kinds[index % kinds.length],
            color: index % 2 === 0 ? '#71806a' : '#86715f',
            walkable: true,
          },
        },
      }),
    );
  }
  for (let index = 0; index < PERFORMANCE_SCENE.aoes; index++) {
    intents.push(
      host.intent('aoe.place', {
        sceneId,
        entity: {
          id: testUlid('AOEPERF', index),
          layer: 'effects',
          name: `AoE ${String(index)}`,
          owners: [],
          transform: transform((index % 10) * 3 + 1.5, 0, Math.floor(index / 10) * 3 + 20),
          aoe: { kind: 'sphere', radius: 1.25, color: '#d65b48' },
        },
      }),
    );
  }
  const replies = await Promise.all(intents);
  expect(replies.every((reply) => reply.t === 'ack')).toBe(true);
});

test.afterAll(async () => {
  await host.close();
  await table.stop();
});

test('idle demand rendering and the budgeted 3D scene stay within budget', async ({ browser }) => {
  test.setTimeout(45_000);
  const client = await openClient(browser, table, 'performance-viewer');
  const page = client.page;
  await expect(page.getByLabel('Scene board')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => (globalThis as unknown as BrowserDiagnostics).__mythicRender !== undefined,
      ),
    )
    .toBe(true);

  await assertIdleForOneSecond(page);
  const info2d = await renderInfo(page);

  await page.getByRole('button', { name: '3D view' }).click();
  await expect(page.getByRole('button', { name: 'Reset view' })).toBeVisible();
  await waitForIdle(page);
  const info3d = await renderInfo(page);
  expect(info3d.triangles).toBeLessThanOrEqual(RENDER_BUDGET.triangles);
  expect(info3d.calls).toBeLessThanOrEqual(RENDER_BUDGET.drawCalls);
  await assertIdleForOneSecond(page);

  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no box');
  const beforeOrbit = await page.evaluate(
    () => (globalThis as unknown as BrowserDiagnostics).__mythicRender?.getFrameCount() ?? -1,
  );
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 50, { steps: 8 });
  await page.mouse.up({ button: 'right' });
  await expect
    .poll(() =>
      page.evaluate(
        () => (globalThis as unknown as BrowserDiagnostics).__mythicRender?.getFrameCount() ?? -1,
      ),
    )
    .toBeGreaterThan(beforeOrbit);

  console.log(
    `M2-10 render results (${String(PERFORMANCE_SCENE.tokens)} tokens, ${String(PERFORMANCE_SCENE.props)} props, ${String(PERFORMANCE_SCENE.aoes)} AoEs): 2D ${String(info2d.triangles)} triangles/${String(info2d.calls)} calls; 3D ${String(info3d.triangles)} triangles/${String(info3d.calls)} calls`,
  );
  await client.context.close();
});
