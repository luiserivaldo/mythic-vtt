import { expect, test, type Page } from '@playwright/test';
import { RawClient, setActiveLayer, startTable, testUlid } from './harness.js';

// UX-41 (UI-TOKEN-05, MV-243): the elevation badge reads relative to the walkable ground under a
// token, so a token on a platform reads 0, a flyer reads its height above what is below it, and the
// badge shows in 3D too (F11). A prop's right-click menu shows and changes whether it is ground.

interface Snapshot {
  scenes: Record<string, { entities: Record<string, { shape?: { walkable: boolean } }> }>;
}

const SCENE = testUlid('SCENE', 41);
const PLATFORM = testUlid('BOX', 41);

const transform = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => ({
  position: { x, y, z },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: sx, y: sy, z: sz },
});

const token = (n: number, name: string, x: number, y: number, z: number, flying = false) => ({
  sceneId: SCENE,
  entity: {
    id: testUlid('TOKEN', n),
    layer: 'tokens',
    name,
    owners: [],
    transform: transform(x, y, z),
    token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all', ...(flying ? { flying } : {}) },
  },
});

async function pageIdentity(page: Page) {
  return page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('mythic.identity.v1') ?? '{}') as {
        identityId: string;
        identitySecret: string;
      },
  );
}

test('badge is relative to the ground, and the collidable toggle changes it', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const table = await startTable();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${table.clientUrl.replace(/\/$/, '')}/#host=${table.hostToken}`);
    await expect(page.getByRole('status')).toHaveText('Connected to New campaign');

    const host = await RawClient.connect(table, { name: 'DM', ...(await pageIdentity(page)) });
    await host.waitFor('snapshot', () => host.state !== undefined);
    const ok = (reply: Promise<unknown>) => expect(reply).resolves.toMatchObject({ t: 'ack' });
    await ok(host.intent('scene.create', { sceneId: SCENE, name: 'Badges' }));
    await ok(host.intent('scene.activate', { sceneId: SCENE }));
    // A 4x2x4 platform (top at 2 cells = 10 ft) covering x 8..12, z 8..12.
    await ok(
      host.intent('entity.create', {
        sceneId: SCENE,
        entity: {
          id: PLATFORM,
          layer: 'props',
          name: 'Dais',
          owners: [],
          transform: transform(10, 0, 10, 4, 2, 4),
          shape: { kind: 'box', color: '#c0803a', walkable: true },
        },
      }),
    );
    await ok(host.intent('entity.create', token(1, 'On platform', 10, 2, 10)));
    await ok(host.intent('entity.create', token(2, 'On ground', 25, 0, 10)));
    await ok(host.intent('entity.create', token(3, 'Flyer over ground', 25, 3, 15, true)));
    await ok(host.intent('entity.create', token(4, 'Flyer over platform', 11, 3, 9, true)));

    const badges = page.getByTestId('elevation-badge');
    // Platform and ground tokens read 0 (no badge); the flyers read their height above the ground.
    await expect(badges).toHaveCount(2);
    await expect(badges.filter({ hasText: '✈ Flying +15 ft' })).toHaveCount(1);
    await expect(badges.filter({ hasText: '✈ Flying +5 ft' })).toHaveCount(1);

    // The prop's right-click menu shows it is ground, and the toggle changes it for everyone.
    const box = await page.locator('canvas').boundingBox();
    if (!box) throw new Error('no canvas box');
    const zoom = Math.min(box.width / 42, box.height / 32);
    const at = (x: number, z: number) => ({
      x: box.x + box.width / 2 + (x - 20) * zoom,
      y: box.y + box.height / 2 + (z - 15) * zoom,
    });
    const point = at(8.5, 11.5);
    const menu = page.getByTestId('prop-context-menu');
    // MV-244: the prop is picked while its layer is the active one.
    await setActiveLayer(page, 'Props');
    await expect(async () => {
      await page.mouse.click(point.x, point.y, { button: 'right' });
      await expect(menu).toBeVisible({ timeout: 1000 });
    }).toPass();
    const collidable = menu.getByRole('menuitemcheckbox', { name: 'Collidable' });
    await expect(collidable).toBeChecked();
    // Controlled by the host's state, so click and wait for the patch rather than a local flip.
    await collidable.click();
    await expect
      .poll(() => (host.state as Snapshot).scenes[SCENE]?.entities[PLATFORM]?.shape?.walkable)
      .toBe(false);
    // No longer ground: the token that stood on it now reads its height above the plane.
    await expect(badges).toHaveCount(3);
    await expect(badges.filter({ hasText: /^\+10 ft$/ })).toHaveCount(1);
    await collidable.click();
    await expect(badges).toHaveCount(2);

    // F11: the height label is drawn in 3D too.
    await page.getByRole('button', { name: '3D view' }).click();
    await expect(page.getByRole('button', { name: 'Reset view' })).toBeVisible();
    await expect(badges.filter({ hasText: '✈ Flying' })).toHaveCount(2);
    expect(errors).toEqual([]);
    await host.close();
  } finally {
    await context.close();
    await table.stop();
  }
});
