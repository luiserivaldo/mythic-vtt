import { expect, test, type Page } from '@playwright/test';
import {
  RawClient,
  setActiveLayer,
  settledCameraPose,
  startTable,
  testUlid,
  type Table,
} from './harness.js';

// UX-16 (UI-INPUT-01..04, UI-TOOL-01/02, C13): the board's mouse mapping. With the Select tool a
// left drag on empty board draws a marquee and never moves the camera; only the Pan tool lets the
// left button pan. Middle drag pans and a middle click on a selected token toggles its flying lock.
// A right click opens the board menu; a right drag orbits in 3D and opens nothing.

interface Snapshot {
  scenes: Record<string, { entities: Record<string, { token?: { flying?: boolean } }> }>;
}

interface Diagnostics {
  __mythicRender?: { getSelection(): string[] };
}

const SCENE = testUlid('SCENE', 160);
const ALPHA = testUlid('TOKEN', 160);
const BRAVO = testUlid('TOKEN', 161);
const CHARLIE = testUlid('TOKEN', 162);

let table: Table | undefined;

test.beforeAll(async () => {
  table = await startTable();
});

test.afterAll(async () => {
  await table?.stop();
});

const selection = (page: Page) =>
  page.evaluate(() =>
    [...((globalThis as unknown as Diagnostics).__mythicRender?.getSelection() ?? [])].sort(),
  );

/** Centre of a token's label, which follows the camera; used to tell whether the view moved. */
async function labelCentre(page: Page, name: string) {
  const box = await page.getByTestId('token-label').filter({ hasText: name }).boundingBox();
  if (!box) throw new Error(`no label for ${name}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('mouse mapping: marquee, pan, flying lock, context menu and orbit', async ({ browser }) => {
  test.setTimeout(150_000);
  if (!table) throw new Error('table not started');
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${table.clientUrl.replace(/\/$/, '')}/#host=${table.hostToken}`);
  await expect(page.getByRole('status')).toHaveText('Connected to New campaign');
  const identity = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('mythic.identity.v1') ?? '{}') as {
        identityId: string;
        identitySecret: string;
      },
  );
  const host = await RawClient.connect(table, { name: 'input host', ...identity });
  await host.waitFor('host snapshot', () => host.state !== undefined);
  const ok = async (reply: Promise<{ t: string }>) => {
    expect((await reply).t).toBe('ack');
  };
  await ok(host.intent('scene.create', { sceneId: SCENE, name: 'Input' }));
  await ok(host.intent('scene.activate', { sceneId: SCENE }));
  const token = (id: string, name: string, x: number, z: number) =>
    host.intent('entity.create', {
      sceneId: SCENE,
      entity: {
        id,
        layer: 'tokens',
        name,
        owners: [],
        transform: {
          position: { x, y: 0, z },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          scale: { x: 1, y: 1, z: 1 },
        },
        token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
      },
    });
  await ok(token(ALPHA, 'Alpha', 5.5, 5.5));
  await ok(token(BRAVO, 'Bravo', 8.5, 7.5));
  await ok(token(CHARLIE, 'Charlie', 30.5, 22.5));
  await expect(page.getByTestId('token-label')).toHaveCount(3);

  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('missing canvas');
  // Default 40x30 scene, framed whole: one cell per scene unit, centred on (20, 15).
  const zoom = Math.min(box.width / 42, box.height / 32);
  const screen = (x: number, z: number) => ({
    x: box.x + box.width / 2 + (x - 20) * zoom,
    y: box.y + box.height / 2 + (z - 15) * zoom,
  });
  const drag = async (
    from: { x: number; y: number },
    to: { x: number; y: number },
    button: 'left' | 'middle' | 'right' = 'left',
  ) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down({ button });
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.mouse.up({ button });
  };
  const select = page.getByRole('button', { name: 'Select', exact: true });
  const pan = page.getByRole('button', { name: 'Pan', exact: true });
  await expect(select).toHaveAttribute('aria-pressed', 'true');
  const boardMenu = page.getByTestId('board-context-menu');

  await test.step('Select: left drag on empty board does not move the camera', async () => {
    const before = await labelCentre(page, 'Alpha');
    await drag(screen(14, 24), screen(26, 28));
    const after = await labelCentre(page, 'Alpha');
    expect(Math.abs(after.x - before.x)).toBeLessThan(1);
    expect(Math.abs(after.y - before.y)).toBeLessThan(1);
    expect(await selection(page)).toEqual([]);
  });

  await test.step('Select: the marquee selects the two tokens inside it', async () => {
    const before = await labelCentre(page, 'Alpha');
    const from = screen(3, 3);
    const to = screen(11, 10);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await expect(page.getByTestId('selection-marquee')).toBeVisible();
    await page.mouse.up();
    await expect(page.getByTestId('selection-marquee')).toHaveCount(0);
    await expect.poll(() => selection(page)).toEqual([ALPHA, BRAVO].sort());
    const after = await labelCentre(page, 'Alpha');
    expect(Math.abs(after.x - before.x)).toBeLessThan(1);
  });

  await test.step('Select: the marquee skips tokens off the active layer (MV-258)', async () => {
    const marquee = () => drag(screen(3, 3), screen(11, 10));
    await setActiveLayer(page, 'Props');
    await expect.poll(() => selection(page)).toEqual([]);
    await marquee();
    await expect.poll(() => selection(page)).toEqual([]);
    await setActiveLayer(page, 'Tokens');
    await marquee();
    await expect.poll(() => selection(page)).toEqual([ALPHA, BRAVO].sort());
  });

  await test.step('Middle click on a selected token toggles its flying lock', async () => {
    const flying = () => (host.state as Snapshot).scenes[SCENE]?.entities[ALPHA]?.token?.flying;
    const before = await labelCentre(page, 'Alpha');
    const at = screen(5.5, 5.5);
    await page.mouse.click(at.x, at.y, { button: 'middle' });
    await expect.poll(flying, { timeout: 10_000 }).toBe(true);
    const after = await labelCentre(page, 'Alpha');
    expect(Math.abs(after.x - before.x)).toBeLessThan(1);
  });

  await test.step('Right click opens the board menu; a right drag in 2D does not', async () => {
    const at = screen(20, 26);
    await page.mouse.click(at.x, at.y, { button: 'right' });
    await expect(boardMenu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(boardMenu).toHaveCount(0);
    await drag(at, { x: at.x + 80, y: at.y - 40 }, 'right');
    await expect(boardMenu).toHaveCount(0);
  });

  await test.step('Middle drag pans', async () => {
    const before = await labelCentre(page, 'Alpha');
    await drag(screen(20, 26), { ...screen(20, 26), x: screen(20, 26).x + 100 }, 'middle');
    await expect
      .poll(async () => (await labelCentre(page, 'Alpha')).x - before.x)
      .toBeGreaterThan(80);
  });

  await test.step('Pan tool: left drag pans', async () => {
    await pan.click();
    await expect(pan).toHaveAttribute('aria-pressed', 'true');
    const before = await labelCentre(page, 'Alpha');
    const from = { x: box.x + box.width / 2, y: box.y + box.height - 60 };
    await drag(from, { x: from.x - 100, y: from.y });
    await expect
      .poll(async () => before.x - (await labelCentre(page, 'Alpha')).x)
      .toBeGreaterThan(80);
    await select.click();
    await expect(select).toHaveAttribute('aria-pressed', 'true');
  });

  await test.step('Create Prop: the board acts like Select; a board click creates nothing (MV-271)', async () => {
    const count = () => Object.keys((host.state as Snapshot).scenes[SCENE]?.entities ?? {}).length;
    const before = count();
    await page.getByRole('button', { name: 'Create Prop', exact: true }).click();
    await expect(page.getByRole('form', { name: 'Create prop' })).toBeVisible();
    const board = await canvas.boundingBox();
    if (!board) throw new Error('missing canvas');
    const at = { x: board.x + board.width / 2, y: board.y + board.height - 60 };
    await page.mouse.click(at.x, at.y);
    await expect.poll(() => selection(page)).toEqual([]);
    // The pans above moved the view and the left pane narrows the board (Alpha is now at its
    // edge): frame the marquee on where Bravo and Charlie are drawn now.
    const bravo = await labelCentre(page, 'Bravo');
    const charlie = await labelCentre(page, 'Charlie');
    await drag(
      { x: charlie.x + 2 * zoom, y: charlie.y + 2 * zoom },
      { x: bravo.x - 2 * zoom, y: bravo.y - 2 * zoom },
    );
    await expect.poll(() => selection(page)).toEqual([BRAVO, CHARLIE].sort());
    expect(count()).toBe(before);
    await select.click();
  });

  await test.step('3D: right drag orbits without a menu; a right click opens it', async () => {
    await page.getByRole('button', { name: '3D view' }).click();
    await page.waitForFunction(
      () => (globalThis as { __mythicCamera?: unknown }).__mythicCamera !== undefined,
    );
    const start = await settledCameraPose(page);
    const at = { x: box.x + box.width / 2, y: box.y + box.height - 60 };
    await drag(at, { x: at.x + 120, y: at.y }, 'right');
    const orbited = await settledCameraPose(page);
    expect(Math.abs(orbited.azimuth - start.azimuth)).toBeGreaterThan(0.1);
    await expect(boardMenu).toHaveCount(0);
    await expect(page.getByTestId('token-context-menu')).toHaveCount(0);

    // A right click with no movement opens the menu and leaves the camera where it was.
    await page.mouse.click(at.x, at.y, { button: 'right' });
    await expect(boardMenu).toBeVisible();
    const clicked = await settledCameraPose(page);
    expect(clicked.azimuth).toBeCloseTo(orbited.azimuth, 8);
    await page.keyboard.press('Escape');

    // Select: a left drag on empty board does not move the 3D camera either.
    await drag(at, { x: at.x - 120, y: at.y - 40 });
    const afterLeft = await settledCameraPose(page);
    expect(afterLeft.targetX).toBeCloseTo(orbited.targetX, 8);
    expect(afterLeft.targetZ).toBeCloseTo(orbited.targetZ, 8);
    expect(afterLeft.azimuth).toBeCloseTo(orbited.azimuth, 8);
  });

  expect(errors).toEqual([]);
  await host.close();
  await context.close();
});
