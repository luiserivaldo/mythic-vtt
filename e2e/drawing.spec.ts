import { expect, test, type Page } from '@playwright/test';
import {
  DRAW_CLEAR_CHANNEL,
  DRAW_ERASE_CHANNEL,
  DRAW_STROKE_CHANNEL,
  DRAW_WIDTH_MAX,
} from '../packages/shared/src/index.js';
import {
  openClient,
  RawClient,
  recordPageFrames,
  settledCameraPose,
  startTable,
  testUlid,
  type Reply,
} from './harness.js';

// LAY-05 (M4-13): freehand drawings live on the effects layer. A drag draws a stroke, the stroke
// reaches every other client live, its author may erase it and the DM may clear the scene. Whether
// a player may draw at all is the scene's own Draw toggle (PERM-05); the host re-checks the
// author of every erase. Drawings are ephemeral: nothing here is an action and nothing is saved.

const COLOUR = '#3b82f6';

interface RenderDiagnostics {
  __mythicRender?: {
    getObjectCount(name: string): number;
    getMeshLayering(name: string): { depthTest: boolean; renderOrder: number }[];
  };
}

/** How many drawing strips this client has rendered, or -1 before the diagnostics mount. */
async function strips(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (globalThis as unknown as RenderDiagnostics).__mythicRender?.getObjectCount(
        'drawing-stroke',
      ) ?? -1,
  );
}

/** The default 42x32 board fills the canvas, so one scale factor maps a cell to a pixel. */
async function cellToPixel(page: Page) {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas box');
  const zoom = Math.min(box.width / 42, box.height / 32);
  return (x: number, z: number) => ({
    x: box.x + box.width / 2 + (x - 20) * zoom,
    y: box.y + box.height / 2 + (z - 15) * zoom,
  });
}

interface DrawingFrame {
  channel?: string;
  from?: string;
  data?: { phase?: string; color?: string; width?: number; sceneId?: string; strokeId?: string };
}

function framesOf(frames: readonly string[], channel: string): DrawingFrame[] {
  return frames
    .map((raw) => JSON.parse(raw) as DrawingFrame)
    .filter((frame) => frame.channel === channel);
}

const ok = async (promise: Promise<Reply>) => {
  expect(await promise).toMatchObject({ t: 'ack' });
};

test('a freehand drawing is shared live, erased by its author, and cleared by the DM', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const table = await startTable();
  // MV-239: the Draw panel opens in the left pane, which narrows the board; a wider window keeps
  // the strokes below clear of the floating rail.
  const dmContext = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const playerContext = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  try {
    const dm = await dmContext.newPage();
    const errors: string[] = [];
    dm.on('pageerror', (error) => errors.push(error.message));
    const dmFrames = recordPageFrames(dm);
    await dm.goto(`${table.clientUrl}/#host=${table.hostToken}`);
    await expect(dm.getByRole('status')).toHaveText('Connected to New campaign');
    const identity = await dm.evaluate(
      () =>
        JSON.parse(localStorage.getItem('mythic.identity.v1') ?? '{}') as {
          identityId: string;
          identitySecret: string;
        },
    );
    const setup = await RawClient.connect(table, { name: 'draw host', ...identity });
    await setup.waitFor('snapshot', () => setup.state !== undefined);
    const sceneId = testUlid('SCENE', 82);
    const seatId = testUlid('SEAT', 82);
    await ok(setup.intent('scene.create', { sceneId, name: 'Draw scene' }));
    await ok(setup.intent('scene.activate', { sceneId }));
    await ok(setup.intent('seat.create', { seatId, label: 'Drawer' }));

    // A player joins the seat. Scenes default to drawing off for players, so the tool is on the
    // rail but disabled, with the scene's own reason.
    const player = await playerContext.newPage();
    player.on('pageerror', (error) => errors.push(error.message));
    const playerFrames = recordPageFrames(player);
    await player.goto(table.clientUrl);
    await player.getByLabel('Display name').fill('Draw guest');
    await player.getByRole('button', { name: 'Continue', exact: true }).click();
    await player.getByRole('radio', { name: /Drawer/ }).check();
    await player.getByRole('button', { name: 'Join participant slot' }).click();
    await expect(player.getByRole('dialog')).toHaveCount(0);
    const draw = player.getByRole('button', { name: 'Draw', exact: true });
    const panel = player.getByRole('region', { name: 'Draw tool' });
    await expect(draw).toHaveAttribute('aria-disabled', 'true');
    await expect(draw).toHaveAttribute('title', 'Drawing is disabled in this scene');
    await draw.click({ force: true });
    await expect(panel).toHaveCount(0);

    // PERM-05: the DM turns drawing on for the scene, and the player's tool becomes usable.
    await ok(setup.intent('scene.setPlayerToggles', { sceneId, toggles: { draw: true } }));
    await expect(draw).not.toHaveAttribute('aria-disabled', 'true');
    await draw.click();
    await expect(draw).toHaveAttribute('aria-pressed', 'true');
    await expect(panel).toBeVisible();
    // A player may erase their own drawings; clearing the board stays the DM's.
    await expect(panel.getByRole('button', { name: 'Clear all drawings' })).toHaveCount(0);
    await panel.getByRole('button', { name: `Draw in ${COLOUR}` }).click();
    // The widest stroke keeps the strips wide enough for the eraser clicks below to land on them.
    await panel.getByLabel('Stroke width').press('End');

    const playerIdentity = await player.evaluate(
      () =>
        (
          JSON.parse(localStorage.getItem('mythic.identity.v1') ?? '{}') as {
            identityId?: string;
          }
        ).identityId ?? '',
    );
    await expect
      .poll(async () => (await strips(dm)) >= 0 && (await strips(player)) >= 0, { timeout: 20_000 })
      .toBe(true);

    // One drag: the stroke reaches the DM before the button is released (shared live), and the
    // wire carries the chosen colour and a scene-unit width the host accepted.
    const at = await cellToPixel(player);
    const start = at(8.5, 8.5);
    const mid = at(11.5, 10.5);
    const end = at(14.5, 12.5);
    await player.mouse.move(start.x, start.y);
    await player.mouse.down();
    await player.mouse.move(mid.x, mid.y, { steps: 4 });
    // Past the broadcast throttle, so the next sample is published while the pointer is down.
    await player.waitForTimeout(120);
    await player.mouse.move(end.x, end.y, { steps: 4 });
    await expect.poll(() => strips(dm), { timeout: 10_000 }).toBe(1);
    await player.mouse.up();
    await expect.poll(() => strips(player), { timeout: 10_000 }).toBe(1);
    await expect.poll(() => strips(dm), { timeout: 10_000 }).toBe(1);
    await expect
      .poll(
        () =>
          framesOf(dmFrames, DRAW_STROKE_CHANNEL).filter(
            (frame) =>
              frame.from === playerIdentity &&
              frame.data?.phase === 'finished' &&
              frame.data.color === COLOUR &&
              frame.data.width === DRAW_WIDTH_MAX &&
              frame.data.sceneId === sceneId,
          ).length,
        { timeout: 10_000 },
      )
      .toBe(1);

    // The DM draws its own stroke on the same board.
    await dm.getByRole('button', { name: 'Draw', exact: true }).click();
    const dmPanel = dm.getByRole('region', { name: 'Draw tool' });
    await expect(dmPanel).toBeVisible();
    await dmPanel.getByLabel('Stroke width').press('End');
    const dmAt = await cellToPixel(dm);
    const dmStart = dmAt(6.5, 20.5);
    const dmEnd = dmAt(18.5, 20.5);
    await dm.mouse.move(dmStart.x, dmStart.y);
    await dm.mouse.down();
    await dm.mouse.move(dmEnd.x, dmEnd.y, { steps: 6 });
    await dm.mouse.up();
    await expect.poll(() => strips(dm), { timeout: 10_000 }).toBe(2);
    await expect.poll(() => strips(player), { timeout: 10_000 }).toBe(2);

    // The player arms the eraser and clicks the DM's drawing: it is not theirs to erase, so
    // nothing happens locally and nothing is sent.
    await panel.getByRole('button', { name: 'Eraser' }).click();
    const middle = at(12.5, 20.5);
    await player.mouse.click(middle.x, middle.y);
    await player.waitForTimeout(200);
    expect(await strips(player)).toBe(2);
    expect(await strips(dm)).toBe(2);
    expect(framesOf(dmFrames, DRAW_ERASE_CHANNEL)).toHaveLength(0);

    // Their own drawing is theirs to erase, and the erase reaches the DM.
    const own = at(11.5, 10.5);
    await player.mouse.click(own.x, own.y);
    await expect.poll(() => strips(player), { timeout: 10_000 }).toBe(1);
    await expect.poll(() => strips(dm), { timeout: 10_000 }).toBe(1);
    await expect
      .poll(
        () =>
          framesOf(dmFrames, DRAW_ERASE_CHANNEL).filter((frame) => frame.from === playerIdentity)
            .length,
        { timeout: 10_000 },
      )
      .toBe(1);

    // LAY-05 works in 3D too: the drag lands on the ground plane and the strip is shared.
    await panel.getByRole('button', { name: 'Eraser' }).click();
    await player.getByRole('button', { name: '3D view' }).click();
    // The orbit diagnostics mount with the 3D camera; then wait for its entry tween to settle so
    // the drag aims at a still board.
    await expect
      .poll(
        () =>
          player.evaluate(
            () =>
              (globalThis as unknown as { __mythicCamera?: unknown }).__mythicCamera !== undefined,
          ),
        { timeout: 10_000 },
      )
      .toBe(true);
    await settledCameraPose(player);
    const canvas = await player.locator('canvas').boundingBox();
    if (!canvas) throw new Error('no canvas box');
    const centreX = canvas.x + canvas.width / 2;
    const centreY = canvas.y + canvas.height / 2;
    await player.mouse.move(centreX - 90, centreY - 40);
    await player.mouse.down();
    await player.mouse.move(centreX + 90, centreY - 40, { steps: 6 });
    await player.mouse.up();
    await expect.poll(() => strips(player), { timeout: 10_000 }).toBe(2);
    await expect.poll(() => strips(dm), { timeout: 10_000 }).toBe(2);

    // The DM clears the scene: every drawing goes, on every client.
    await dm.getByRole('button', { name: 'Clear all drawings' }).click();
    await expect.poll(() => strips(dm), { timeout: 10_000 }).toBe(0);
    await expect.poll(() => strips(player), { timeout: 10_000 }).toBe(0);
    await expect
      .poll(
        () =>
          framesOf(playerFrames, DRAW_CLEAR_CHANNEL).filter(
            (frame) => frame.data?.sceneId === sceneId,
          ).length,
        { timeout: 10_000 },
      )
      .toBe(1);

    expect(errors).toEqual([]);
    await setup.close();
  } finally {
    await dmContext.close();
    await playerContext.close();
    await table.stop();
  }
});

/** The RGB of one page pixel, read back from a screenshot (the canvas itself is not readable). */
async function pixelAt(page: Page, x: number, y: number): Promise<[number, number, number]> {
  const png = (await page.screenshot()).toString('base64');
  // A string expression: the e2e project has no DOM typings, and this runs in the page.
  const rgb = await page.evaluate<number[]>(`(async () => {
    const image = new Image();
    image.src = 'data:image/png;base64,${png}';
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    return Array.from(context.getImageData(${String(Math.round(x))}, ${String(Math.round(y))}, 1, 1).data);
  })()`);
  return [rgb[0] ?? 0, rgb[1] ?? 0, rgb[2] ?? 0];
}

async function layering(page: Page) {
  return page.evaluate(
    () =>
      (globalThis as unknown as RenderDiagnostics).__mythicRender?.getMeshLayering(
        'drawing-stroke',
      ) ?? [],
  );
}

// UX-40 (playtest F19, F20): in 2D a drawing is the top layer over a tall prop; it can be taken
// back with Undo (button and Ctrl+Z) and removed with the eraser, and both reach other clients.
test('a drawing sits over a tall prop in 2D, and can be undone and erased', async ({ browser }) => {
  test.setTimeout(120_000);
  const table = await startTable();
  const dmContext = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  let spectatorContext: Awaited<ReturnType<typeof openClient>>['context'] | undefined;
  try {
    const dm = await dmContext.newPage();
    const errors: string[] = [];
    dm.on('pageerror', (error) => errors.push(error.message));
    await dm.goto(`${table.clientUrl}/#host=${table.hostToken}`);
    await expect(dm.getByRole('status')).toHaveText('Connected to New campaign');
    const identity = await dm.evaluate(
      () =>
        JSON.parse(localStorage.getItem('mythic.identity.v1') ?? '{}') as {
          identityId: string;
          identitySecret: string;
        },
    );
    const setup = await RawClient.connect(table, { name: 'layer host', ...identity });
    await setup.waitFor('snapshot', () => setup.state !== undefined);
    const sceneId = testUlid('SCENE', 83);
    await ok(setup.intent('scene.create', { sceneId, name: 'Layer scene' }));
    await ok(setup.intent('scene.activate', { sceneId }));
    // A tall red pillar in the middle of the board: its top stands well above the ground samples.
    await ok(
      setup.intent('entity.create', {
        sceneId,
        entity: {
          id: testUlid('PROP', 83),
          name: 'Tall pillar',
          layer: 'props',
          owners: [],
          transform: {
            position: { x: 20, y: 0, z: 15 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 4, y: 4, z: 4 },
          },
          shape: { kind: 'cylinder', color: '#ff0000', walkable: true },
        },
      }),
    );

    const spectator = await openClient(browser, table, 'viewer');
    spectatorContext = spectator.context;
    spectator.page.on('pageerror', (error) => errors.push(error.message));
    await expect.poll(() => strips(spectator.page), { timeout: 20_000 }).toBe(0);
    await expect.poll(() => strips(dm), { timeout: 20_000 }).toBe(0);

    await dm.getByRole('button', { name: 'Draw', exact: true }).click();
    const panel = dm.getByRole('region', { name: 'Draw tool' });
    await panel.getByRole('button', { name: `Draw in ${COLOUR}` }).click();
    await panel.getByLabel('Stroke width').press('End');

    const at = await cellToPixel(dm);
    const draw = async (fromX: number, toX: number, z: number) => {
      const start = at(fromX, z);
      const end = at(toX, z);
      await dm.mouse.move(start.x, start.y);
      await dm.mouse.down();
      await dm.mouse.move(end.x, end.y, { steps: 6 });
      await dm.mouse.up();
    };

    // F19: a line drawn across the pillar is the top layer in 2D - the pixel on the pillar is the
    // stroke's blue, not the pillar's red - and the strip opts out of depth testing.
    await draw(17.5, 22.5, 15);
    await expect.poll(() => strips(dm), { timeout: 10_000 }).toBe(1);
    await expect.poll(() => strips(spectator.page), { timeout: 10_000 }).toBe(1);
    expect(await layering(dm)).toEqual([{ depthTest: false, renderOrder: 30 }]);
    const centre = at(20, 15);
    await expect
      .poll(
        async () => {
          const [r, , b] = await pixelAt(dm, centre.x, centre.y);
          return b - r;
        },
        { timeout: 10_000 },
      )
      .toBeGreaterThan(80);

    // In 3D the strip depth-tests again, so a real object in front still hides it.
    await dm.getByRole('button', { name: '3D view' }).click();
    await expect
      .poll(async () => (await layering(dm))[0]?.depthTest, { timeout: 10_000 })
      .toBe(true);
    await dm.getByRole('button', { name: '2D view' }).click();
    await expect
      .poll(async () => (await layering(dm))[0]?.depthTest, { timeout: 10_000 })
      .toBe(false);

    // F20, undo: Ctrl+Z while the Draw tool is armed takes back the newest own drawing, for all.
    await draw(17.5, 22.5, 12);
    await expect.poll(() => strips(dm), { timeout: 10_000 }).toBe(2);
    await expect.poll(() => strips(spectator.page), { timeout: 10_000 }).toBe(2);
    await dm.keyboard.press('Control+z');
    await expect.poll(() => strips(dm), { timeout: 10_000 }).toBe(1);
    await expect.poll(() => strips(spectator.page), { timeout: 10_000 }).toBe(1);
    // The panel's Undo button does the same and reaches the end of the list.
    await panel.getByRole('button', { name: 'Undo drawing' }).click();
    await expect.poll(() => strips(dm), { timeout: 10_000 }).toBe(0);
    await expect.poll(() => strips(spectator.page), { timeout: 10_000 }).toBe(0);

    // F20, erase: the eraser removes one drawing and leaves the others.
    await draw(17.5, 22.5, 12);
    await draw(17.5, 22.5, 18);
    await expect.poll(() => strips(dm), { timeout: 10_000 }).toBe(2);
    await panel.getByRole('button', { name: 'Eraser' }).click();
    const target = at(20, 12);
    await dm.mouse.click(target.x, target.y);
    await expect.poll(() => strips(dm), { timeout: 10_000 }).toBe(1);
    await expect.poll(() => strips(spectator.page), { timeout: 10_000 }).toBe(1);

    expect(errors).toEqual([]);
    await setup.close();
  } finally {
    await spectatorContext?.close();
    await dmContext.close();
    await table.stop();
  }
});
