import { expect, test, type Browser, type Page } from '@playwright/test';
import { openClient, settledCameraPose, startTable, type Client, type Table } from './harness.js';

// M4-11 / CAM-06: the DM "pulls all players to my view" and a spectator can follow the DM camera.
// The pose travels on the camera.pose ephemeral; the host refuses one from anyone but the DM, and
// a viewer that was pulled or is following adopts it (clamped to its own canvas) with a tween in
// the same ≤ 300 ms budget as the rest of the camera moves.
//
// Every assertion is behavioural: what a client's own camera reports through the development
// diagnostics, not what the DOM says.

interface View2d {
  centerX: number;
  centerZ: number;
  zoom: number;
  animating: boolean;
  poses: number;
}

interface Pose {
  targetX: number;
  targetY: number;
  targetZ: number;
  azimuth: number;
  polar: number;
  distance: number;
}

interface Diagnostics {
  __mythicFocus?: { getView2d(): View2d };
  __mythicCamera?: { getPose(): Pose };
  __mythicCameraLink?: { getLink(): { sent: number; pulls: number; following: boolean } };
}

/** Cells the centre may be off by, and the zoom fraction, once a tween has landed. */
const TOLERANCE_CELLS = 0.06;
const TOLERANCE_ZOOM = 0.002;

async function readView2d(page: Page): Promise<View2d> {
  return page.evaluate(() => {
    const focus = (globalThis as unknown as Diagnostics).__mythicFocus;
    if (!focus) throw new Error('2D camera diagnostics are not mounted');
    return focus.getView2d();
  });
}

async function waitForView2d(page: Page, target: View2d): Promise<void> {
  await page.waitForFunction(
    ({
      expected,
      cells,
      zoomFraction,
    }: {
      expected: View2d;
      cells: number;
      zoomFraction: number;
    }) => {
      const view = (globalThis as unknown as Diagnostics).__mythicFocus?.getView2d();
      if (!view) return false;
      return (
        Math.abs(view.centerX - expected.centerX) <= cells &&
        Math.abs(view.centerZ - expected.centerZ) <= cells &&
        Math.abs(view.zoom - expected.zoom) <= expected.zoom * zoomFraction
      );
    },
    { expected: target, cells: TOLERANCE_CELLS, zoomFraction: TOLERANCE_ZOOM },
  );
}

async function waitForPose(page: Page, target: Pose): Promise<void> {
  await page.waitForFunction((expected: Pose) => {
    const pose = (globalThis as unknown as Diagnostics).__mythicCamera?.getPose();
    if (!pose) return false;
    return (
      Math.abs(pose.targetX - expected.targetX) <= 0.06 &&
      Math.abs(pose.targetY - expected.targetY) <= 0.06 &&
      Math.abs(pose.targetZ - expected.targetZ) <= 0.06 &&
      Math.abs(pose.azimuth - expected.azimuth) <= 1e-3 &&
      Math.abs(pose.polar - expected.polar) <= 1e-3 &&
      Math.abs(pose.distance - expected.distance) <= Math.max(0.06, expected.distance * 0.002)
    );
  }, target);
}

async function readLink(page: Page): Promise<{ sent: number; pulls: number; following: boolean }> {
  return page.evaluate(() => {
    const link = (globalThis as unknown as Diagnostics).__mythicCameraLink;
    if (!link) throw new Error('camera-link diagnostics are not mounted');
    return link.getLink();
  });
}

/** The middle of the board, where no panel sits and dragging pans rather than selects. */
async function boardCentre(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) throw new Error('no board canvas');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Move the DM's camera: a wheel zoom and a small pan, in whichever mode the client is in. */
async function moveCamera(page: Page, wheel: number, drag: number): Promise<void> {
  const centre = await boardCentre(page);
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.wheel(0, wheel);
  await page.waitForTimeout(60);
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(centre.x + drag, centre.y + drag / 2, { steps: 8 });
  await page.mouse.up({ button: 'left' });
}

/** The DM adds one free player seat, so a player client can join it by name. */
async function addPlayerSeat(dm: Page, label: string): Promise<void> {
  await dm.getByRole('tab', { name: 'Participants', exact: true }).click();
  await dm.getByPlaceholder('Custom participant name').fill(label);
  await dm.getByRole('button', { name: 'Add custom participant' }).click();
  await expect(dm.getByText(label, { exact: true }).first()).toBeVisible();
}

/** A first-time visitor joins the table by name, seated in the only free slot. */
async function joinAsPlayer(page: Page, name: string): Promise<void> {
  await page.getByLabel('Display name').fill(name);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('radio', { name: /Player/ }).check();
  await page.getByRole('button', { name: 'Join participant slot' }).click();
  await expect(page.getByRole('status')).toHaveText('Connected to New campaign');
}

/**
 * A fresh table with the DM's browser on it. The host token is single use, so every test starts
 * its own table (and its own campaign) rather than sharing one.
 */
async function openDm(
  browser: Browser,
  search: string,
): Promise<{ dm: Client & { table: Table }; close: () => Promise<void> }> {
  const table = await startTable();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${table.clientUrl.replace(/\/$/, '')}/${search}#host=${table.hostToken}`);
  await expect(page.getByRole('status')).toHaveText('Connected to New campaign');
  return {
    dm: { name: 'dm', context, page, table },
    close: async () => {
      await context.close();
      await table.stop();
    },
  };
}

test('the DM pulls a player to their 2D view and a spectator follows the DM camera', async ({
  browser,
}) => {
  const errors: string[] = [];
  const { dm, close } = await openDm(browser, '');
  try {
    await addPlayerSeat(dm.page, 'Followed');

    const player = await openClient(browser, dm.table, 'player', { joinScreen: true });
    player.page.on('pageerror', (error) => errors.push(error.message));
    await expect(player.page.getByRole('dialog', { name: 'Join the table' })).toBeVisible();
    await joinAsPlayer(player.page, 'Followed Rogue');

    const spectator = await openClient(browser, dm.table, 'watcher');
    await expect(spectator.page.getByRole('status')).toHaveText('Connected to New campaign');

    // Only the DM gets the pull; a spectator gets the follow switch instead.
    await expect(dm.page.getByRole('button', { name: 'Pull players to my view' })).toBeVisible();
    await expect(player.page.getByRole('button', { name: 'Pull players to my view' })).toHaveCount(
      0,
    );
    await expect(player.page.getByRole('button', { name: 'Follow the DM camera' })).toHaveCount(0);
    await expect(
      spectator.page.getByRole('button', { name: 'Pull players to my view' }),
    ).toHaveCount(0);
    await expect(
      spectator.page.getByRole('button', { name: 'Follow the DM camera' }),
    ).toHaveAttribute('aria-pressed', 'false');

    // Both clients have framed the whole scene by now; those baselines must not move on their own.
    await player.page.waitForTimeout(300);
    const before = await readView2d(player.page);
    const spectatorBefore = await readView2d(spectator.page);
    await moveCamera(dm.page, -400, 90);
    const moved = await readView2d(dm.page);
    expect(Math.abs(moved.zoom - before.zoom)).toBeGreaterThan(1);
    // Nothing follows a DM camera that has not asked anyone to: neither a player nor a spectator.
    expect(await readView2d(player.page)).toEqual(before);
    expect(await readView2d(spectator.page)).toEqual(spectatorBefore);

    await dm.page.getByRole('button', { name: 'Pull players to my view' }).click();
    await expect.poll(async () => (await readLink(dm.page)).pulls).toBe(1);
    // The player's camera lands on the DM's, tweened rather than teleported.
    await waitForView2d(player.page, moved);
    // A spectator that has not opted in stays where it was.
    expect(await readView2d(spectator.page)).toEqual(spectatorBefore);

    // Following needs no pull: the spectator catches the DM camera on the next heartbeat.
    await spectator.page.getByRole('button', { name: 'Follow the DM camera' }).click();
    await expect(
      spectator.page.getByRole('button', { name: 'Follow the DM camera' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await waitForView2d(spectator.page, moved);

    // And it keeps following: the DM moves again and the follower tracks it.
    await moveCamera(dm.page, 300, -120);
    const movedAgain = await readView2d(dm.page);
    expect(Math.abs(movedAgain.zoom - moved.zoom)).toBeGreaterThan(0.5);
    await waitForView2d(spectator.page, movedAgain);
    // A player is pulled, never dragged along: without a new pull it stays on the last one.
    expect(await readView2d(player.page)).toEqual(moved);

    // The spectator can stop following; the DM's next move then leaves it alone.
    await spectator.page.getByRole('button', { name: 'Follow the DM camera' }).click();
    await expect(
      spectator.page.getByRole('button', { name: 'Follow the DM camera' }),
    ).toHaveAttribute('aria-pressed', 'false');
    const settled = await readView2d(spectator.page);
    await moveCamera(dm.page, -260, 0);
    await expect.poll(async () => (await readView2d(dm.page)).zoom).not.toBe(movedAgain.zoom);
    await spectator.page.waitForTimeout(400);
    expect(await readView2d(spectator.page)).toEqual(settled);

    await player.context.close();
    await spectator.context.close();
  } finally {
    await close();
  }
  expect(errors).toEqual([]);
});

test('a pull adopts the DM 3D camera, mode included', async ({ browser }) => {
  const errors: string[] = [];
  const { dm, close } = await openDm(browser, '?camera=3d');
  try {
    await addPlayerSeat(dm.page, 'Adopted');

    const player = await openClient(browser, dm.table, 'player-3d', { joinScreen: true });
    player.page.on('pageerror', (error) => errors.push(error.message));
    await joinAsPlayer(player.page, 'Adopted Rogue');
    // The player starts in 2D, so the pull has to carry the DM's mode as well as the pose.
    await expect(player.page.getByRole('button', { name: '2D view' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Orbit the DM's 3D camera so its pose is plainly not the default one.
    const centre = await boardCentre(dm.page);
    await dm.page.mouse.move(centre.x, centre.y);
    await dm.page.mouse.down({ button: 'right' });
    await dm.page.mouse.move(centre.x + 140, centre.y - 60, { steps: 10 });
    await dm.page.mouse.up({ button: 'right' });
    await dm.page.mouse.wheel(0, -200);
    const dmPose = await settledCameraPose(dm.page);

    await dm.page.getByRole('button', { name: 'Pull players to my view' }).click();
    await waitForPose(player.page, dmPose);
    await expect(player.page.getByRole('button', { name: '3D view' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await player.context.close();
  } finally {
    await close();
  }
  expect(errors).toEqual([]);
});
