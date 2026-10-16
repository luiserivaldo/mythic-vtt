import { expect, test, type Locator, type Page } from '@playwright/test';
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
}

/** The orbit's tilt limit toward top-down (camera-3d.ts MIN_POLAR, 5 degrees). */
const MIN_POLAR = (5 * Math.PI) / 180;
/** One rotate-button press (camera-joystick.ts ROTATE_STEP, 15 degrees). */
const ROTATE_STEP = Math.PI / 12;

async function cameraPose(page: Page): Promise<CameraPose> {
  return page.evaluate(() => {
    const camera = (globalThis as typeof globalThis & CameraDiagnostics).__mythicCamera;
    if (!camera) throw new Error('3D camera diagnostics are not mounted');
    return camera.getPose();
  });
}

/** Signed azimuth change from `a` to `b`, wrapped to (-PI, PI]. */
const turn = (a: CameraPose, b: CameraPose) =>
  Math.atan2(Math.sin(b.azimuth - a.azimuth), Math.cos(b.azimuth - a.azimuth));

async function waitForCameraToRest(page: Page): Promise<CameraPose> {
  await page.waitForFunction(
    () => (globalThis as typeof globalThis & CameraDiagnostics).__mythicCamera !== undefined,
  );
  let previous = await cameraPose(page);
  await expect
    .poll(async () => {
      const current = await cameraPose(page);
      const still =
        Math.abs(turn(previous, current)) < 1e-9 &&
        Math.abs(current.polar - previous.polar) < 1e-9 &&
        Math.abs(current.distance - previous.distance) < 1e-9;
      previous = current;
      return still;
    })
    .toBe(true);
  return previous;
}

/** Push the joystick knob by a fraction of its radius and hold it there until `until` passes. */
async function holdKnob(
  page: Page,
  joystick: Locator,
  fx: number,
  fy: number,
  until: () => Promise<void>,
): Promise<void> {
  const box = await joystick.boundingBox();
  if (!box) throw new Error('joystick has no box');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + (fx * box.width) / 2, cy + (fy * box.height) / 2, { steps: 4 });
  await until();
  await page.mouse.up();
}

let table: Table | undefined;

test.beforeAll(async () => {
  table = await startTable();
});

test.afterAll(async () => {
  await table?.stop();
});

// UX-17 / UI-CAM-01..03 (CAM-02): the Pan tool's 3D camera joystick.
test('the 3D Pan panel rotates and tilts the camera, stays open for its own controls and closes on a mouse move', async ({
  browser,
}) => {
  if (!table) throw new Error('table not started');
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  await page.goto(`${table.clientUrl.replace(/\/$/, '')}/#host=${table.hostToken}`);
  await expect(page.getByRole('status')).toHaveText('Connected to New campaign');

  const pane = page.getByRole('complementary', { name: 'Left pane' });
  const panTool = page.getByRole('button', { name: 'Pan', exact: true });
  const bar = page.getByRole('button', { name: 'Restore Camera panel' });
  const joystick = page.getByRole('group', { name: 'Camera joystick' });
  const panel = page.locator('[data-tool-panel="camera"]');

  // 2D: the Pan tool keeps no panel, so there is no joystick and no left pane.
  await panTool.click();
  await expect(panTool).toHaveAttribute('aria-pressed', 'true');
  await expect(pane).toHaveCount(0);
  await expect(bar).toHaveCount(0);
  await expect(joystick).toHaveCount(0);

  // 3D: the Pan panel is a bar in the left pane that expands to the joystick.
  await page.getByRole('button', { name: '3D view' }).click();
  await expect(page.getByRole('button', { name: 'Reset view' })).toBeVisible();
  await expect(pane.getByRole('button', { name: 'Restore Camera panel' })).toBeVisible();
  await expect(joystick).toHaveCount(0);
  await bar.click();
  await expect(pane.getByRole('group', { name: 'Camera joystick' })).toBeVisible();
  // UI-CAM-02: rotate and tilt only; no elevation and no sideways pan controls.
  await expect(panel.getByRole('button', { name: 'Rotate clockwise' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Rotate anticlockwise' })).toBeVisible();
  await expect(
    panel.getByRole('button', { name: /elevat|raise|lower|\bup\b|\bdown\b/i }),
  ).toHaveCount(0);
  await expect(panel.getByRole('button', { name: /\bpan\b|\bleft\b|\bright\b/i })).toHaveCount(0);

  // Pushed right, the joystick rotates the camera clockwise and leaves its focus where it was.
  const start = await waitForCameraToRest(page);
  await holdKnob(page, joystick, 0.9, 0, async () => {
    await expect.poll(async () => turn(start, await cameraPose(page))).toBeLessThan(-0.2);
  });
  const rotated = await waitForCameraToRest(page);
  expect(rotated.polar).toBeCloseTo(start.polar, 6);
  expect(rotated.targetX).toBeCloseTo(start.targetX, 6);
  expect(rotated.targetZ).toBeCloseTo(start.targetZ, 6);
  expect(rotated.distance).toBeCloseTo(start.distance, 6);
  await expect(joystick).toBeVisible();

  // Pushed forward, it leans the camera toward the horizon (MV-274).
  await holdKnob(page, joystick, 0, -0.9, async () => {
    await expect
      .poll(async () => (await cameraPose(page)).polar)
      .toBeGreaterThan(rotated.polar + 0.1);
  });
  const tilted = await waitForCameraToRest(page);
  expect(turn(rotated, tilted)).toBeCloseTo(0, 6);
  await expect(joystick).toBeVisible();

  // Held back, the tilt stops at the orbit's own top-down limit (CAM-02).
  await holdKnob(page, joystick, 0, 1, async () => {
    await expect.poll(async () => (await cameraPose(page)).polar).toBeCloseTo(MIN_POLAR, 6);
  });
  const clamped = await waitForCameraToRest(page);
  expect(clamped.polar).toBeCloseTo(MIN_POLAR, 6);

  // The rotate buttons step the camera and keep the panel open too.
  await panel.getByRole('button', { name: 'Rotate anticlockwise' }).click();
  await expect.poll(async () => turn(clamped, await cameraPose(page))).toBeCloseTo(ROTATE_STEP, 6);
  await expect(joystick).toBeVisible();

  // UI-CAM-03: the mouse wheel zooms without closing the panel.
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no box');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const beforeZoom = await cameraPose(page);
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, -300);
  await expect
    .poll(async () => (await cameraPose(page)).distance)
    .not.toBeCloseTo(beforeZoom.distance, 3);
  await expect(joystick).toBeVisible();

  // UI-CAM-03: a mouse orbit on the board closes the panel back to its bar.
  const beforeOrbit = await cameraPose(page);
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(x + 80, y, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  expect(Math.abs(turn(beforeOrbit, await cameraPose(page)))).toBeGreaterThan(0.05);
  await expect(joystick).toHaveCount(0);
  await expect(bar).toBeVisible();

  // ...and so does a left-drag pan with the Pan tool.
  await bar.click();
  await expect(joystick).toBeVisible();
  const panBox = await canvas.boundingBox();
  if (!panBox) throw new Error('canvas has no box');
  const px = panBox.x + panBox.width / 2;
  const py = panBox.y + panBox.height / 2;
  const beforePan = await cameraPose(page);
  await page.mouse.move(px, py);
  await page.mouse.down();
  await page.mouse.move(px + 80, py + 20, { steps: 5 });
  await page.mouse.up();
  const afterPan = await cameraPose(page);
  expect(
    Math.hypot(afterPan.targetX - beforePan.targetX, afterPan.targetZ - beforePan.targetZ),
  ).toBeGreaterThan(0.05);
  await expect(joystick).toHaveCount(0);
  await expect(bar).toBeVisible();

  // Back in 2D, the Pan tool shows no joystick again.
  await page.getByRole('button', { name: '2D view' }).click();
  await expect(panTool).toHaveAttribute('aria-pressed', 'true');
  await expect(bar).toHaveCount(0);
  await expect(joystick).toHaveCount(0);
  await context.close();
});
