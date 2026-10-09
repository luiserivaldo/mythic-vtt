import { expect, test, type Page } from '@playwright/test';
import { startTable, type Table } from './harness.js';

interface CameraPose {
  targetX: number;
  targetY: number;
  targetZ: number;
  azimuth: number;
  polar: number;
  distance: number;
}

interface CameraDiagnostics {
  __mythicCamera?: { getPose(): CameraPose };
  __mythicCameraRest?: { azimuth: number; polar: number; distance: number; stable: number };
}

async function cameraPose(page: Page): Promise<CameraPose> {
  return page.evaluate(() => {
    const camera = (globalThis as typeof globalThis & CameraDiagnostics).__mythicCamera;
    if (!camera) throw new Error('3D camera diagnostics are not mounted');
    return camera.getPose();
  });
}

async function waitForCameraToRest(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const state = globalThis as typeof globalThis & CameraDiagnostics;
    const camera = state.__mythicCamera;
    if (!camera) return false;
    const current = camera.getPose();
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

test('held right orbits while middle and available left pan monotonically', async ({ browser }) => {
  if (!table) throw new Error('table not started');
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${table.clientUrl.replace(/\/$/, '')}/#host=${table.hostToken}`);
  await expect(page.getByRole('status')).toHaveText('Connected to New campaign');
  await page.getByRole('button', { name: '3D view' }).click();
  await expect(page.getByRole('button', { name: 'Reset view' })).toBeVisible();
  await expect(page.getByText('left-drag empty board or middle-drag pan')).toBeVisible();
  await expect(page.getByText('right-drag orbit')).toBeVisible();
  await waitForCameraToRest(page);

  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no box');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'right' });
  const orbitPoses: CameraPose[] = [await cameraPose(page)];
  for (const dx of [20, 40, 60, 80, 100]) {
    await page.mouse.move(x + dx, y, { steps: 2 });
    orbitPoses.push(await cameraPose(page));
  }
  await page.mouse.up({ button: 'right' });
  for (let i = 1; i < orbitPoses.length; i++) {
    expect(orbitPoses[i]?.azimuth).toBeLessThan(
      orbitPoses[i - 1]?.azimuth ?? Number.NEGATIVE_INFINITY,
    );
  }

  for (const button of ['middle', 'left'] as const) {
    await page.getByRole('button', { name: 'Reset view' }).click();
    await waitForCameraToRest(page);
    await page.mouse.move(x, y);
    await page.mouse.down({ button });
    const panPoses: CameraPose[] = [await cameraPose(page)];
    for (const dx of [20, 40, 60, 80, 100]) {
      await page.mouse.move(x + dx, y, { steps: 2 });
      panPoses.push(await cameraPose(page));
    }
    await page.mouse.up({ button });
    const panStart = panPoses[0];
    if (!panStart) throw new Error('camera pan was not sampled');
    let previousDistance = 0;
    for (const pose of panPoses.slice(1)) {
      const distance = Math.hypot(pose.targetX - panStart.targetX, pose.targetZ - panStart.targetZ);
      expect(distance).toBeGreaterThan(previousDistance);
      expect(pose.azimuth).toBeCloseTo(panStart.azimuth, 8);
      previousDistance = distance;
    }
  }

  await page.getByRole('button', { name: 'Reset view' }).click();
  await waitForCameraToRest(page);
  const beforeToolDrag = await cameraPose(page);
  const ruler = page.getByRole('button', { name: 'Ruler' });
  await ruler.click();
  await expect(ruler).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(x + 100, y, { steps: 5 });
  await page.mouse.up({ button: 'left' });
  const afterToolDrag = await cameraPose(page);
  expect(afterToolDrag.targetX).toBeCloseTo(beforeToolDrag.targetX, 8);
  expect(afterToolDrag.targetZ).toBeCloseTo(beforeToolDrag.targetZ, 8);
  await context.close();
});
