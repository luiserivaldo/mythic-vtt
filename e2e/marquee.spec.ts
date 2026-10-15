import { expect, test, type Page } from '@playwright/test';
import { connectAoEPlacer } from './aoe-fixture.js';
import {
  RawClient,
  setActiveLayer,
  stableBoardLayout,
  startTable,
  testUlid,
  type ScreenBox,
  type Table,
} from './harness.js';

// UX-50 (MV-272; UI-TOOL-01, UI-INPUT-01, C24): the selection marquee gathers tokens, props and
// AoEs on the active layer. A battlemap is never gathered, and a press on it still starts the
// marquee, unless the Map layer is active; then the map is gathered like any other object. Tools
// that do not claim an empty-board drag (here Initiative) leave it to the marquee.

interface Diagnostics {
  __mythicRender?: { getSelection(): string[] };
}

const SCENE = testUlid('MARQSCENE', 1);
const TOKEN = testUlid('MARQTOKEN', 1);
const MAP = testUlid('MARQMAP', 1);
const AOE = testUlid('MARQAOE', 1);
const EFFECT = testUlid('MARQAOE', 2);

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

/** Centre of a token's label, which follows the camera. */
async function labelCentre(page: Page, name: string) {
  const box = await page.getByTestId('token-label').filter({ hasText: name }).boundingBox();
  if (!box) throw new Error(`no label for ${name}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Zoom of an untouched view, which frames the default 40x30 scene whole with one cell of margin. */
const fitZoom = (box: ScreenBox) => Math.min(box.width / 42, box.height / 32);

const transform = (x: number, z: number, scale = 1) => ({
  position: { x, y: 0, z },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: scale, y: scale, z: scale },
});

test('marquee gathers tokens and AoEs, and the map only on the Map layer', async ({ browser }) => {
  test.setTimeout(120_000);
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
  const host = await RawClient.connect(table, { name: 'marquee host', ...identity });
  await host.waitFor('host snapshot', () => host.state !== undefined);
  const ok = async (reply: Promise<{ t: string }>) => {
    expect((await reply).t).toBe('ack');
  };
  await ok(host.intent('scene.create', { sceneId: SCENE, name: 'Marquee' }));
  await ok(host.intent('scene.activate', { sceneId: SCENE }));
  // A 6-cell battlemap centred on (8, 8) lies under the token and the AoEs.
  await ok(
    host.intent('entity.create', {
      sceneId: SCENE,
      entity: {
        id: MAP,
        layer: 'map',
        name: 'Marquee map',
        owners: [],
        transform: transform(8, 8, 6),
        image: {
          asset: { source: 'local', hash: 'c'.repeat(64), kind: 'image' },
          calibrated: true,
        },
      },
    }),
  );
  await ok(
    host.intent('entity.create', {
      sceneId: SCENE,
      entity: {
        id: TOKEN,
        layer: 'tokens',
        name: 'Marquee hero',
        owners: [],
        transform: transform(6.5, 6.5),
        token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
      },
    }),
  );
  // One AoE on the Tokens layer and one on Effects, each placed by its own co-DM (one per identity).
  const placers: RawClient[] = [];
  for (const [index, id, layer, x, z] of [
    [1, AOE, 'tokens', 9.5, 8.5],
    [2, EFFECT, 'effects', 8.5, 10.5],
  ] as const) {
    const placer = await connectAoEPlacer(table, host, id, 2720 + index);
    placers.push(placer);
    await ok(
      placer.intent('aoe.place', {
        sceneId: SCENE,
        entity: {
          id,
          layer,
          name: `Marquee AoE ${String(index)}`,
          owners: [],
          transform: transform(x, z),
          aoe: { kind: 'sphere', radius: 1, color: '#ff7744' },
        },
      }),
    );
  }
  await expect(page.getByTestId('token-label')).toHaveCount(1);

  const framed = await stableBoardLayout(page);
  // Default 40x30 scene, framed whole: one cell per scene unit, centred on (20, 15).
  const zoom = fitZoom(framed);
  const box = framed;
  const screen = (x: number, z: number) => ({
    x: box.x + box.width / 2 + (x - 20) * zoom,
    y: box.y + box.height / 2 + (z - 15) * zoom,
  });
  const drag = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await expect(page.getByTestId('selection-marquee')).toBeVisible();
    await page.mouse.up();
    await expect(page.getByTestId('selection-marquee')).toHaveCount(0);
  };
  /** A marquee around everything: the map, the token and both AoEs. */
  const around = () => drag(screen(3, 3), screen(13, 13));
  const select = page.getByRole('button', { name: 'Select', exact: true });
  await expect(select).toHaveAttribute('aria-pressed', 'true');

  await test.step('Tokens layer: the token and its AoE, not the map or the Effects AoE', async () => {
    await setActiveLayer(page, 'Tokens');
    await around();
    await expect.poll(() => selection(page)).toEqual([TOKEN, AOE].sort());
  });

  await test.step('a press on the map starts the marquee while Tokens is active', async () => {
    const empty = screen(14, 20);
    await page.mouse.click(empty.x, empty.y);
    await expect.poll(() => selection(page)).toEqual([]);
    // (10.5, 5.5) lies on the map but on nothing else; the box spans the token and both AoEs.
    await drag(screen(10.5, 5.5), screen(3, 12));
    await expect.poll(() => selection(page)).toEqual([TOKEN, AOE].sort());
  });

  await test.step('Effects layer: only the Effects AoE', async () => {
    await setActiveLayer(page, 'Effects');
    await around();
    await expect.poll(() => selection(page)).toEqual([EFFECT]);
  });

  await test.step('Map layer: the same drag selects the map', async () => {
    await setActiveLayer(page, 'Map');
    await around();
    await expect.poll(() => selection(page)).toEqual([MAP]);
  });

  await test.step('Initiative: a left drag on empty board draws the marquee', async () => {
    await setActiveLayer(page, 'Tokens');
    const initiative = page.getByRole('button', { name: 'Initiative', exact: true });
    await initiative.click();
    await expect(initiative).toHaveAttribute('aria-pressed', 'true');
    // The left pane narrows the board and moves the view: frame the marquee on where the hero's
    // label (above its centre, at (6.5, 6.5)) is drawn now, as an offset in scene cells. MV-277:
    // wait for the renderer to resize and re-frame first; the untouched view re-zooms to fit.
    const narrowed = await stableBoardLayout(page);
    const paneZoom = fitZoom(narrowed);
    const hero = await labelCentre(page, 'Marquee hero');
    const at = (x: number, z: number) => ({
      x: hero.x + (x - 6.5) * paneZoom,
      y: hero.y + (z - 6.5) * paneZoom,
    });
    const empty = at(12, 14);
    await page.mouse.click(empty.x, empty.y);
    await expect.poll(() => selection(page)).toEqual([]);
    // From empty board below right of the map to above left of the hero.
    await drag(at(12, 12), at(4.5, 4.5));
    await expect.poll(() => selection(page)).toEqual([TOKEN, AOE].sort());
    await expect(initiative).toHaveAttribute('aria-pressed', 'true');
    // The drag drew the marquee and did not pan the view.
    const after = await labelCentre(page, 'Marquee hero');
    expect(Math.abs(after.x - hero.x)).toBeLessThan(1);
    expect(Math.abs(after.y - hero.y)).toBeLessThan(1);
  });

  expect(errors).toEqual([]);
  for (const placer of placers) await placer.close();
  await host.close();
  await context.close();
});
