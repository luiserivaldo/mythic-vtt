import { expect, test, type Page } from '@playwright/test';
import { startTable, type Table } from './harness.js';

interface CameraPose {
  targetX: number;
  targetZ: number;
  azimuth: number;
}

async function cameraPose(page: Page): Promise<CameraPose> {
  return page.evaluate(() => {
    const camera = window.__mythicCamera;
    if (!camera) throw new Error('3D camera diagnostics are not mounted');
    return camera.getPose();
  });
}

async function waitForCameraToRest(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const camera = window.__mythicCamera;
    if (!camera) return false;
    const current = camera.getPose();
    const state = window as Window & {
      __mythicCameraRest?: { azimuth: number; polar: number; distance: number; stable: number };
    };
    const previous = state.__mythicCameraRest;
    const unchanged =
      previous !== undefined &&
      Math.abs(previous.azimuth - current.azimuth) < 1e-8 &&
      Math.abs(previous.polar - current.polar) < 1e-8 &&
      Math.abs(previous.distance - current.distance) < 1e-8;
    state.__mythicCameraRest = {
      azimuth: current.azimuth,
      polar: current.polar,
      distance: current.distance,
      stable: unchanged ? previous.stable + 1 : 0,
    };
    return state.__mythicCameraRest.stable >= 3;
  });
}

let table: Table | undefined;

test.beforeAll(async () => {
  table = await startTable();
});

test.afterAll(async () => {
  await table?.stop();
});

test('held right/middle orbit and Shift-pan change the 3D camera monotonically', async ({
  browser,
}) => {
  if (!table) throw new Error('table not started');
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${table.clientUrl.replace(/\/$/, '')}/#host=${table.hostToken}`);
  await expect(page.getByRole('status')).toHaveText('Connected to New campaign');
  await page.getByRole('button', { name: '3D view' }).click();
  await expect(page.getByRole('button', { name: 'Reset view' })).toBeVisible();
  await expect(page.getByText('right or middle drag orbit')).toBeVisible();
  await waitForCameraToRest(page);

  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no box');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  for (const button of ['right', 'middle'] as const) {
    await page.mouse.move(x, y);
    await page.mouse.down({ button });
    const poses: CameraPose[] = [await cameraPose(page)];
    for (const dx of [20, 40, 60, 80, 100]) {
      await page.mouse.move(x + dx, y, { steps: 2 });
      poses.push(await cameraPose(page));
    }
    await page.mouse.up({ button });
    for (let i = 1; i < poses.length; i++) {
      expect(poses[i]?.azimuth).toBeLessThan(poses[i - 1]?.azimuth ?? Number.NEGATIVE_INFINITY);
    }
    await page.getByRole('button', { name: 'Reset view' }).click();
    await waitForCameraToRest(page);
  }

  await page.mouse.move(x, y);
  await page.keyboard.down('Shift');
  await page.mouse.down({ button: 'right' });
  const panPoses: CameraPose[] = [await cameraPose(page)];
  for (const dx of [20, 40, 60, 80, 100]) {
    await page.mouse.move(x + dx, y, { steps: 2 });
    panPoses.push(await cameraPose(page));
  }
  await page.mouse.up({ button: 'right' });
  await page.keyboard.up('Shift');
  const panStart = panPoses[0];
  if (!panStart) throw new Error('camera pan was not sampled');
  let previousDistance = 0;
  for (const pose of panPoses.slice(1)) {
    const distance = Math.hypot(pose.targetX - panStart.targetX, pose.targetZ - panStart.targetZ);
    expect(distance).toBeGreaterThan(previousDistance);
    expect(pose.azimuth).toBeCloseTo(panStart.azimuth, 8);
    previousDistance = distance;
  }
  await context.close();
});
