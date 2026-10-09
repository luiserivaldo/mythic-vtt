import { expect, test, type Page } from '@playwright/test';
import { openClient, startTable, type Table } from './harness.js';

interface CameraPose {
  targetX: number;
  targetY: number;
  targetZ: number;
  azimuth: number;
  polar: number;
  distance: number;
}

async function cameraPose(page: Page): Promise<CameraPose> {
  return page.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      __mythicCamera?: { getPose(): CameraPose };
    };
    if (!scope.__mythicCamera) throw new Error('3D camera diagnostics are not mounted');
    return scope.__mythicCamera.getPose();
  });
}

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
  const tanVertical = Math.tan(Math.PI / 6); // M2-12 default vertical FOV is 60 degrees.
  const ndcX = cameraX / (depth * tanVertical * (box.width / box.height));
  const ndcY = cameraY / (depth * tanVertical);
  return {
    x: box.x + ((ndcX + 1) * box.width) / 2,
    y: box.y + ((1 - ndcY) * box.height) / 2,
  };
}

// M3-06 (MEAS-02): use the real DM link, place a tall walkable surface, and verify that a
// surface-to-ground ruler exposes horizontal, vertical and total scene-unit distances remotely.
let table: Table | undefined;

test.beforeAll(async () => {
  table = await startTable();
});

test.afterAll(async () => {
  await table?.stop();
});

test('the DM measures a 3D surface and shares the H/V/T readout', async ({ browser }, testInfo) => {
  if (!table) throw new Error('table not started');
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto(`${table.clientUrl.replace(/\/$/, '')}/#host=${table.hostToken}`);
  await expect(page.getByRole('status')).toHaveText('Connected to New campaign');
  await page.getByRole('button', { name: 'Scenes', exact: true }).click();
  await page.getByLabel('New scene name').fill('Vertical test');
  await page.getByRole('button', { name: 'Create scene' }).click();
  await expect(page.getByText('Active', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  const prop = page.getByRole('form', { name: 'Create prop' });
  await prop.getByLabel('Prop name').fill('High platform');
  await prop.getByLabel('Width (cells)').fill('6');
  await prop.getByLabel('Height (cells)').fill('10');
  await prop.getByLabel('Depth (cells)').fill('6');
  await prop.getByLabel('Walkable').check();
  await prop.getByRole('button', { name: 'Create prop' }).click();
  await expect(page.getByRole('button', { name: 'High platform', exact: true })).toBeVisible();

  const viewer = await openClient(browser, table, 'viewer');
  viewer.page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('button', { name: '3D view' }).click();
  await viewer.page.getByRole('button', { name: '3D view' }).click();
  await expect(page.getByRole('button', { name: 'Reset view' })).toBeVisible();
  await expect(viewer.page.getByRole('button', { name: 'Reset view' })).toBeVisible();
  await page.getByRole('button', { name: 'Reset view' }).click();

  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas box');
  const pose = await cameraPose(page);
  const ground = projectToCanvas(pose, box, { x: 20, y: 0, z: 25 });
  const platformTop = projectToCanvas(pose, box, { x: 20, y: 10, z: 15 });
  await page.getByRole('button', { name: 'Ruler' }).click();
  await page.getByLabel('Persistent').check();
  // The platform spawns at scene centre. Project known world points through the live pose so this
  // regression remains about surface measurement rather than one particular camera framing.
  await page.mouse.move(ground.x, ground.y);
  await page.mouse.down();
  await page.mouse.move(platformTop.x, platformTop.y, { steps: 8 });
  await page.mouse.up();

  const detailed = /^H .+ · V (?!0(?:\.0+)? ft).+ · T .+$/;
  await expect(page.getByTestId('ruler-total')).toHaveText(detailed);
  // M1-33: 3D also keeps the host echo out of the sender's remote-ruler layer.
  await expect(page.getByTestId('remote-ruler-total')).toHaveCount(0);
  await expect(viewer.page.getByTestId('remote-ruler-total')).toHaveText(
    /^DM: H .+ · V (?!0(?:\.0+)? ft).+ · T .+$/,
  );
  await page.screenshot({ path: testInfo.outputPath('ruler-3d.png') });
  expect(errors).toEqual([]);

  await viewer.context.close();
  await context.close();
});
