import { expect, test, type Page } from '@playwright/test';
import {
  RawClient,
  recordPageFrames,
  seedProfile,
  setActiveLayer,
  startTable,
  testUlid,
  type Table,
} from './harness.js';

// UI-LAY-01 (MV-244): for the DM, objects off the active layer take a darker shade (2D and 3D) and
// clicks pass through them to the active layer. The map layer (battlemap) is exempt: never shaded,
// always pickable. Players and spectators keep their board as before, and the DM layer still never
// reaches them (PERM-03).

const SCENE = testUlid('SCENE', 258);
const SEAT = testUlid('SEAT', 258);
const SECRET = testUlid('TOKEN', 258);
const SECRET_NAME = 'Hidden Lurker MV258';
const HERO = testUlid('TOKEN', 259);
const MAP = testUlid('MAP', 258);
const MAP_HASH = 'c'.repeat(64);

async function meshColors(page: Page, name: string): Promise<string[]> {
  return page.evaluate(
    (n) =>
      (
        globalThis as unknown as { __mythicRender?: { getMeshColors(name: string): string[] } }
      ).__mythicRender?.getMeshColors(n) ?? [],
    name,
  );
}

const at = (x: number, z: number) => ({
  position: { x, y: 0, z },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: 1, y: 1, z: 1 },
});
// Both tokens stand on the board centre, so a click there hits both and only the layer decides.
const tokenOn = (id: string, layer: 'dm' | 'tokens', name: string) => ({
  id,
  layer,
  name,
  owners: [],
  transform: at(20, 15),
  token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all', color: '#40c0ff' },
});

// A battlemap covering the whole board, under both tokens.
const battlemap = {
  id: MAP,
  layer: 'map',
  name: 'Battlemap',
  owners: [],
  transform: { ...at(20, 15), scale: { x: 60, y: 60, z: 60 } },
  image: { asset: { source: 'local', hash: MAP_HASH, kind: 'image' }, calibrated: true },
};

let table: Table | undefined;
test.beforeAll(async () => {
  table = await startTable();
});
test.afterAll(async () => {
  await table?.stop();
});

test('inactive layers are shaded and skipped by picking for the DM only, without leaking the DM layer', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  if (!table) throw new Error('table not started');
  const identity = { identityId: testUlid('HOST', 258), identitySecret: 'inactive-layer-host' };
  const host = await RawClient.connect(table, {
    name: 'DM',
    ...identity,
    hostToken: table.hostToken,
  });
  const ok = async (type: string, payload: Record<string, unknown>) => {
    expect(await host.intent(type, payload), type).toMatchObject({ t: 'ack' });
  };
  await ok('scene.create', { sceneId: SCENE, name: 'Layers' });
  await ok('scene.activate', { sceneId: SCENE });
  await ok('seat.create', { seatId: SEAT, label: 'Rogue' });
  await ok('entity.create', { sceneId: SCENE, entity: tokenOn(SECRET, 'dm', SECRET_NAME) });
  await ok('entity.create', { sceneId: SCENE, entity: tokenOn(HERO, 'tokens', 'Hero') });
  await ok('entity.create', { sceneId: SCENE, entity: battlemap });

  const player = await RawClient.connect(table, {
    name: 'player',
    identityId: testUlid('PLAYER', 258),
    identitySecret: 'inactive-layer-player',
  });
  await player.waitFor('player snapshot', () => player.state !== undefined);
  player.join(SEAT);

  const dmContext = await browser.newContext();
  let mapLoaded = false;
  await dmContext.route(`**/assets/${MAP_HASH}*`, async (route) => {
    await route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#9a7355"/></svg>',
    });
    mapLoaded = true;
  });
  await dmContext.addInitScript((value) => {
    localStorage.setItem('mythic.identity.v1', JSON.stringify(value));
    localStorage.setItem('mythic.host', '1');
  }, identity);
  const dm = await dmContext.newPage();
  const viewerContext = await browser.newContext();
  await seedProfile(viewerContext, 'viewer');
  const viewer = await viewerContext.newPage();
  const viewerFrames = recordPageFrames(viewer);
  const errors: string[] = [];
  dm.on('pageerror', (error) => errors.push(error.message));
  viewer.on('pageerror', (error) => errors.push(error.message));

  try {
    await dm.goto(table.clientUrl);
    await expect(dm.getByRole('status')).toHaveText('Connected to New campaign');
    await viewer.goto(table.clientUrl);
    await expect(viewer.getByRole('status')).toHaveText('Connected to New campaign');

    const card = dm.getByTestId('token-preview-name');
    async function clickCentre(dx = 0): Promise<void> {
      const box = await dm.locator('canvas').boundingBox();
      if (!box) throw new Error('canvas has no box');
      await dm.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2);
    }

    /** With Tokens active the battlemap keeps its colour and a click off the tokens selects it. */
    async function expectMapExempt(): Promise<void> {
      await expect.poll(() => mapLoaded).toBe(true);
      await expect.poll(async () => meshColors(dm, MAP)).toEqual(['#ffffff']);
      await dm.getByRole('tab', { name: 'Entities', exact: true }).click();
      const selected = dm.getByRole('checkbox', { name: 'Select Battlemap' });
      await expect(selected).not.toBeChecked();
      await expect(async () => {
        await clickCentre(150);
        await expect(selected).toBeChecked({ timeout: 1000 });
      }).toPass();
      await dm.keyboard.press('Escape');
      await expect(selected).not.toBeChecked();
    }

    /** Colours of each token's meshes; the shaded one must differ from the other. */
    async function expectShade(active: string, inactive: string): Promise<void> {
      await expect.poll(async () => (await meshColors(dm, active)).length).toBeGreaterThan(0);
      await expect
        .poll(async () => {
          const [a, i] = [await meshColors(dm, active), await meshColors(dm, inactive)];
          // Both tokens use the same colours, so each shaded mesh (2D quad; 3D base and quad)
          // reads strictly darker than its unshaded counterpart.
          const sums = (hexes: string[]) =>
            hexes
              .map((hex) => [1, 3, 5].reduce((s, k) => s + parseInt(hex.slice(k, k + 2), 16), 0))
              .sort((x, y) => x - y);
          const [sa, si] = [sums(a), sums(i)];
          return sa.length === si.length && sa.every((value, k) => value > (si[k] ?? Infinity));
        })
        .toBe(true);
    }

    // Default active layer is Tokens: the DM-layer token is shaded and a click passes through it.
    await expectShade(HERO, SECRET);
    await clickCentre();
    await expect(card).toHaveText('Hero');
    await dm.keyboard.press('Escape');
    // The map layer is exempt from the shade and the click-through rule.
    await expectMapExempt();

    // Switching to DM only swaps the shade and drops the now-inactive selection.
    await setActiveLayer(dm, 'DM only');
    await expect(card).toHaveCount(0);
    await expectShade(SECRET, HERO);
    await clickCentre();
    await expect(card).toHaveText(SECRET_NAME);
    await dm.keyboard.press('Escape');

    // 3D: the same shading on standees.
    await dm.getByRole('button', { name: '3D view' }).click();
    await expectShade(SECRET, HERO);
    await setActiveLayer(dm, 'Tokens');
    await expectShade(HERO, SECRET);
    await expectMapExempt();

    // A spectator board is never shaded and never holds the DM layer.
    await expect.poll(async () => (await meshColors(viewer, HERO)).length).toBeGreaterThan(0);
    expect(await meshColors(viewer, SECRET)).toEqual([]);
    const heroColours = await meshColors(viewer, HERO);
    expect(heroColours).toContain('#40c0ff');

    // PERM-03: neither the seated player nor the spectator ever receives the DM-layer token.
    await player.waitForSeq(host.lastSeq);
    const leaks = (frames: readonly string[]) =>
      frames.filter((f) => f.includes(SECRET) || f.includes(SECRET_NAME));
    expect(leaks(player.frames)).toEqual([]);
    expect(leaks(viewerFrames)).toEqual([]);
    expect(viewerFrames.length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  } finally {
    await player.close();
    await host.close();
    await dmContext.close();
    await viewerContext.close();
  }
});
