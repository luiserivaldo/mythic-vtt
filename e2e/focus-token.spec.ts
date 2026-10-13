import { expect, test, type Browser, type Page } from '@playwright/test';
import { RawClient, startTable, testUlid, type Table } from './harness.js';

// M4-10 (CAM-06): double-clicking a token tweens the camera onto it — in 2D and in 3D — and the
// move finishes inside the <= 300 ms interaction budget. Camera focus is per-client view state
// (Pillar 1): it is never an action, never reaches the host and is not part of any leak surface.
// Both tests drive a real DM client, so the token is also *selected* by the first click of the
// double-click, exactly as it is at a table.

/** On the default 40x30 canvas the framed centre is (20, 15), so this token starts well off it. */
const TOKEN = { x: 28, z: 6, sizeCells: 3 };
/** CAM-02: the 3D camera lens, needed to project the token back onto the screen. */
const FOV_DEGREES = 60;

interface Pose {
  targetX: number;
  targetY: number;
  targetZ: number;
  azimuth: number;
  polar: number;
  distance: number;
}

interface View2d {
  centerX: number;
  centerZ: number;
  zoom: number;
  animating: boolean;
  poses: number;
}

interface Diagnostics {
  __mythicFocus?: { getView2d(): View2d };
  __mythicCamera?: { getPose(): Pose };
  // Scratch space the stability waiters keep between polls, plus the frame sampler's samples.
  __mythicFocusRest?: { centerX: number; centerZ: number; zoom: number; stable: number };
  __mythicCameraRest?: { azimuth: number; polar: number; distance: number; stable: number };
  __mythicSamples?: number[];
}

interface View {
  table: Table;
  page: Page;
  close(): Promise<void>;
}

/**
 * A DM browser client on its own table with the focus token on the board. The scene is created
 * through a raw client that reuses the page's own host identity (as `drag-snapback.spec.ts` does),
 * so the page stays the host: a selected token, a gizmo and every permission apply.
 */
async function openDmView(browser: Browser, camera: '2d' | '3d'): Promise<View> {
  const table = await startTable();
  const context = await browser.newContext({ viewport: { width: 1000, height: 900 } });
  const page = await context.newPage();
  const search = camera === '3d' ? '?camera=3d' : '';
  await page.goto(`${table.clientUrl.replace(/\/$/, '')}/${search}#host=${table.hostToken}`);
  await expect(page.getByRole('status')).toHaveText('Connected to New campaign');
  const identity = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('mythic.identity.v1') ?? '{}') as {
        identityId: string;
        identitySecret: string;
      },
  );
  const setup = await RawClient.connect(table, { name: 'focus setup', ...identity });
  await setup.waitFor('host snapshot', () => setup.state !== undefined);
  const scene = testUlid('SCENE', 1);
  expect((await setup.intent('scene.create', { sceneId: scene, name: 'Focus' })).t).toBe('ack');
  expect((await setup.intent('scene.activate', { sceneId: scene })).t).toBe('ack');
  expect(
    (
      await setup.intent('entity.create', {
        sceneId: scene,
        entity: {
          id: testUlid('TOKEN', 1),
          layer: 'tokens',
          name: 'Marker',
          owners: [],
          transform: {
            position: { x: TOKEN.x, y: 0, z: TOKEN.z },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
          },
          token: { sizeCells: TOKEN.sizeCells, heightCells: 1, labelVisibility: 'all' },
        },
      })
    ).t,
  ).toBe('ack');
  await setup.close();
  return {
    table,
    page,
    async close() {
      await context.close();
      await table.stop();
    },
  };
}

async function readView2d(page: Page): Promise<View2d> {
  return page.evaluate(() => {
    const view = (globalThis as unknown as Diagnostics).__mythicFocus?.getView2d();
    if (!view) throw new Error('2D camera diagnostics are not mounted');
    return view;
  });
}

async function readPose(page: Page): Promise<Pose> {
  return page.evaluate(() => {
    const pose = (globalThis as unknown as Diagnostics).__mythicCamera?.getPose();
    if (!pose) throw new Error('3D camera diagnostics are not mounted');
    return pose;
  });
}

/** Waits until the 2D camera stops moving, so a screen position computed from it stays valid. */
async function waitForSettledView(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const diagnostics = globalThis as unknown as Diagnostics;
    const view = diagnostics.__mythicFocus?.getView2d();
    if (!view) return false;
    const previous = diagnostics.__mythicFocusRest;
    const same =
      previous !== undefined &&
      previous.centerX === view.centerX &&
      previous.centerZ === view.centerZ &&
      previous.zoom === view.zoom;
    diagnostics.__mythicFocusRest = {
      centerX: view.centerX,
      centerZ: view.centerZ,
      zoom: view.zoom,
      stable: same ? previous.stable + 1 : 0,
    };
    return diagnostics.__mythicFocusRest.stable >= 3;
  });
}

/** The same, for the 3D orbit: the focus and the pose must both be still before projecting. */
async function waitForSettledPose(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const diagnostics = globalThis as unknown as Diagnostics;
    const pose = diagnostics.__mythicCamera?.getPose();
    if (!pose) return false;
    const previous = diagnostics.__mythicCameraRest;
    const same =
      previous !== undefined &&
      previous.azimuth === pose.azimuth &&
      previous.polar === pose.polar &&
      previous.distance === pose.distance;
    diagnostics.__mythicCameraRest = {
      azimuth: pose.azimuth,
      polar: pose.polar,
      distance: pose.distance,
      stable: same ? previous.stable + 1 : 0,
    };
    return diagnostics.__mythicCameraRest.stable >= 3;
  });
}

/** Records the camera centre on every frame, so a tween can be seen travelling and not jumping. */
async function recordCentres(page: Page, view: '2d' | '3d'): Promise<void> {
  await page.evaluate((which) => {
    const diagnostics = globalThis as unknown as Diagnostics;
    // `page.evaluate` serialises this callback and runs it in the browser, where the frame clock
    // exists; this package's tsconfig has no DOM lib, so it is reached through a cast.
    const raf = (globalThis as unknown as { requestAnimationFrame: (cb: () => void) => number })
      .requestAnimationFrame;
    const samples: number[] = [];
    diagnostics.__mythicSamples = samples;
    const read = () =>
      which === '2d'
        ? diagnostics.__mythicFocus?.getView2d().centerX
        : diagnostics.__mythicCamera?.getPose().targetX;
    const tick = () => {
      const value = read();
      if (value !== undefined) samples.push(value);
      raf(tick);
    };
    raf(tick);
  }, view);
}

async function recordedCentres(page: Page): Promise<number[]> {
  return page.evaluate(() => (globalThis as unknown as Diagnostics).__mythicSamples ?? []);
}

/** Two frames of the on-demand loop, so a stray tween would have moved the camera by now. */
async function settleFrames(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const raf = (globalThis as unknown as { requestAnimationFrame: (cb: () => void) => number })
      .requestAnimationFrame;
    await new Promise<void>((resolve) => {
      raf(() => {
        raf(() => {
          resolve();
        });
      });
    });
  });
}

/** Samples that lie strictly between the two centres: proof the camera travelled, not teleported. */
function between(samples: readonly number[], from: number, to: number): number[] {
  const low = Math.min(from, to) + 1e-6;
  const high = Math.max(from, to) - 1e-6;
  return samples.filter((value) => value > low && value < high);
}

/** Where the token is on screen in 2D: `screenToWorld` (camera-2d.ts) inverted. */
function screenPoint2d(
  view: View2d,
  box: { x: number; y: number; width: number; height: number },
): { x: number; y: number } {
  return {
    x: box.x + box.width / 2 + (TOKEN.x - view.centerX) * view.zoom,
    y: box.y + box.height / 2 + (TOKEN.z - view.centerZ) * view.zoom,
  };
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** The same for 3D: the token's standee quad centre, projected through the live orbit pose. */
function screenPoint3d(
  pose: Pose,
  box: { x: number; y: number; width: number; height: number },
): { x: number; y: number } {
  const sinPolar = Math.sin(pose.polar);
  const camera: Vec3 = {
    x: pose.targetX + pose.distance * sinPolar * Math.sin(pose.azimuth),
    y: pose.targetY + pose.distance * Math.cos(pose.polar),
    z: pose.targetZ + pose.distance * sinPolar * Math.cos(pose.azimuth),
  };
  const cross = (a: Vec3, b: Vec3): Vec3 => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  });
  const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
  const normalise = (v: Vec3): Vec3 => {
    const length = Math.hypot(v.x, v.y, v.z);
    return { x: v.x / length, y: v.y / length, z: v.z / length };
  };
  // The basis the orbit camera looks along: forward to the focus, up = world +Y, no roll.
  const forward = normalise({
    x: pose.targetX - camera.x,
    y: pose.targetY - camera.y,
    z: pose.targetZ - camera.z,
  });
  const right = normalise(cross(forward, { x: 0, y: 1, z: 0 }));
  const up = cross(right, forward);
  const delta: Vec3 = {
    // BASE_THICKNESS + half the standee quad height (M2-06), so the quad centre is the target.
    x: TOKEN.x - camera.x,
    y: 0.06 + 0.6 * TOKEN.sizeCells - camera.y,
    z: TOKEN.z - camera.z,
  };
  const depth = dot(delta, forward);
  const tanHalfFov = Math.tan((FOV_DEGREES * Math.PI) / 360);
  const ndcX = dot(delta, right) / (depth * tanHalfFov * (box.width / box.height));
  const ndcY = dot(delta, up) / (depth * tanHalfFov);
  return {
    x: box.x + ((ndcX + 1) / 2) * box.width,
    y: box.y + ((1 - ndcY) / 2) * box.height,
  };
}

test('double-clicking a token in 2D tweens the camera onto it and an empty board does not', async ({
  browser,
}) => {
  const view = await openDmView(browser, '2d');
  const page = view.page;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await expect(page.getByLabel('Scene board')).toBeVisible();
    await expect(page.getByTestId('token-label')).toHaveText('Marker');
    const box = await page.locator('canvas').boundingBox();
    if (!box) throw new Error('canvas has no box');
    await waitForSettledView(page);
    const before = await readView2d(page);
    // D37: the board is framed as a whole, so the token starts off the centre.
    expect(before.centerX).toBeCloseTo(20, 1);
    expect(before.centerZ).toBeCloseTo(15, 1);

    const at = screenPoint2d(before, box);
    expect(at.x).toBeGreaterThan(box.x);
    expect(at.x).toBeLessThan(box.x + box.width);
    expect(at.y).toBeGreaterThan(box.y);
    expect(at.y).toBeLessThan(box.y + box.height);

    await recordCentres(page, '2d');
    await page.mouse.dblclick(at.x, at.y);
    await page.waitForFunction(
      (target) => {
        const current = (globalThis as unknown as Diagnostics).__mythicFocus?.getView2d();
        return (
          current !== undefined &&
          Math.abs(current.centerX - target.x) < 1e-6 &&
          Math.abs(current.centerZ - target.z) < 1e-6
        );
      },
      { x: TOKEN.x, z: TOKEN.z },
    );
    const after = await readView2d(page);
    expect(after.centerX).toBeCloseTo(TOKEN.x, 6);
    expect(after.centerZ).toBeCloseTo(TOKEN.z, 6);
    // Focus re-centres: it does not zoom.
    expect(after.zoom).toBeCloseTo(before.zoom, 6);
    // The tween has finished and its frame loop is idle, not spinning.
    expect(after.animating).toBe(false);

    // The camera travelled through the middle instead of teleporting, over several frames.
    const travelled = between(await recordedCentres(page), before.centerX, TOKEN.x);
    expect(travelled.length).toBeGreaterThan(1);
    expect(after.poses).toBeGreaterThan(1);

    // A double-click on the empty board is not a focus request.
    await page.mouse.dblclick(box.x + box.width * 0.12, box.y + box.height * 0.12);
    await settleFrames(page);
    const idle = await readView2d(page);
    expect(idle.centerX).toBe(after.centerX);
    expect(idle.centerZ).toBe(after.centerZ);
    expect(idle.animating).toBe(false);

    expect(errors).toEqual([]);
  } finally {
    await view.close();
  }
});

test('double-clicking a token in 3D tweens the focus onto it without changing the orbit', async ({
  browser,
}) => {
  const view = await openDmView(browser, '3d');
  const page = view.page;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await expect(page.getByLabel('Scene board')).toBeVisible();
    await expect(page.getByTestId('token-label')).toHaveText('Marker');
    const box = await page.locator('canvas').boundingBox();
    if (!box) throw new Error('canvas has no box');
    await waitForSettledPose(page);
    const before = await readPose(page);
    expect(before.targetX).toBeCloseTo(20, 1);
    expect(before.targetZ).toBeCloseTo(15, 1);

    const at = screenPoint3d(before, box);
    expect(at.x).toBeGreaterThan(box.x);
    expect(at.x).toBeLessThan(box.x + box.width);
    expect(at.y).toBeGreaterThan(box.y);
    expect(at.y).toBeLessThan(box.y + box.height);

    await recordCentres(page, '3d');
    await page.mouse.dblclick(at.x, at.y);
    await page.waitForFunction(
      (target) => {
        const pose = (globalThis as unknown as Diagnostics).__mythicCamera?.getPose();
        return (
          pose !== undefined &&
          Math.abs(pose.targetX - target.x) < 1e-6 &&
          Math.abs(pose.targetZ - target.z) < 1e-6
        );
      },
      { x: TOKEN.x, z: TOKEN.z },
    );
    const after = await readPose(page);
    expect(after.targetX).toBeCloseTo(TOKEN.x, 6);
    expect(after.targetZ).toBeCloseTo(TOKEN.z, 6);
    // CAM-06 is a focus move: the orbit pose is untouched, so the view cannot roll or re-zoom.
    expect(after.azimuth).toBeCloseTo(before.azimuth, 6);
    expect(after.polar).toBeCloseTo(before.polar, 6);
    expect(after.distance).toBeCloseTo(before.distance, 6);
    // The token stands on the ground, so the focus ends at ground level.
    expect(after.targetY).toBeCloseTo(0.05, 6);

    const travelled = between(await recordedCentres(page), before.targetX, TOKEN.x);
    expect(travelled.length).toBeGreaterThan(1);

    expect(errors).toEqual([]);
  } finally {
    await view.close();
  }
});
