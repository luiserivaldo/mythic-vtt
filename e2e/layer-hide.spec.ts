import { expect, test, type Page } from '@playwright/test';
import {
  RawClient,
  setActiveLayer,
  settledCameraPose,
  startTable,
  testUlid,
  type Table,
} from './harness.js';

// UI-LAY-01 / F23: unchecking "Show <layer>" removes that layer's entities from the DM's own scene
// (drawn and picked), in 2D and 3D, for every layer. The eye is local view state only.

async function objectNames(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      (
        globalThis as unknown as { __mythicRender?: { getObjectNames(): string[] } }
      ).__mythicRender?.getObjectNames() ?? [],
  );
}

let table: Table | undefined;
test.beforeAll(async () => {
  table = await startTable();
});
test.afterAll(async () => {
  await table?.stop();
});

test('hiding a layer removes its entities from the scene and from picking, in 2D and 3D', async ({
  browser,
}) => {
  if (!table) throw new Error('table not started');
  const identity = { identityId: testUlid('HOST', 238), identitySecret: 'layer-hide-host' };
  const setup = await RawClient.connect(table, {
    name: 'DM',
    ...identity,
    hostToken: table.hostToken,
  });
  const sceneId = testUlid('SCENE', 238);
  const dmToken = testUlid('TOKEN', 238);
  const pcToken = testUlid('TOKEN', 239);
  const at = (x: number, z: number) => ({
    position: { x, y: 0, z },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  });
  expect(await setup.intent('scene.create', { sceneId, name: 'Hide' })).toMatchObject({
    t: 'ack',
  });
  expect(await setup.intent('scene.activate', { sceneId })).toMatchObject({ t: 'ack' });
  // The DM-layer token sits at the board centre so a click on the canvas centre targets it.
  for (const [id, layer, name, x, z] of [
    [dmToken, 'dm', 'Secret', 20, 15],
    [pcToken, 'tokens', 'Hero', 5, 5],
  ] as const) {
    expect(
      await setup.intent('entity.create', {
        sceneId,
        entity: {
          id,
          layer,
          name,
          owners: [],
          transform: at(x, z),
          token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
        },
      }),
    ).toMatchObject({ t: 'ack' });
  }

  const context = await browser.newContext();
  await context.addInitScript((value) => {
    localStorage.setItem('mythic.identity.v1', JSON.stringify(value));
    localStorage.setItem('mythic.host', '1');
  }, identity);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(table.clientUrl);
    await expect(page.getByRole('status')).toHaveText('Connected to New campaign');
    // MV-244: the DM token is only pickable while its layer is the active one.
    await setActiveLayer(page, 'DM only');
    const layers = page.getByRole('region', { name: 'Layers' });
    await expect(layers.getByRole('checkbox', { name: 'Show DM only' })).toBeVisible();
    // UI-TOKEN-01: a single selected token shows its preview card.
    const selectedCard = page.getByTestId('token-preview');

    /** Where the DM token is on screen: the canvas centre in 2D, its projected standee in 3D. */
    async function pickToken(mode: '2d' | '3d'): Promise<void> {
      const box = await page.locator('canvas').boundingBox();
      if (!box) throw new Error('canvas has no box');
      let x = box.x + box.width / 2;
      let y = box.y + box.height / 2;
      if (mode === '3d') {
        const pose = await settledCameraPose(page);
        const sinPolar = Math.sin(pose.polar);
        const cam = [
          pose.targetX + pose.distance * sinPolar * Math.sin(pose.azimuth),
          pose.targetY + pose.distance * Math.cos(pose.polar),
          pose.targetZ + pose.distance * sinPolar * Math.cos(pose.azimuth),
        ] as const;
        type V = readonly [number, number, number];
        const cross = (a: V, b: V): V => [
          a[1] * b[2] - a[2] * b[1],
          a[2] * b[0] - a[0] * b[2],
          a[0] * b[1] - a[1] * b[0],
        ];
        const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        const norm = (a: V): V => {
          const l = Math.hypot(...a);
          return [a[0] / l, a[1] / l, a[2] / l];
        };
        const forward = norm([pose.targetX - cam[0], pose.targetY - cam[1], pose.targetZ - cam[2]]);
        const right = norm(cross(forward, [0, 1, 0]));
        const up = cross(right, forward);
        // Token at (20, 15), standee quad centre 0.06 + 0.6 above the ground (1-cell token).
        const delta: V = [20 - cam[0], 0.66 - cam[1], 15 - cam[2]];
        const depth = dot(delta, forward);
        const tanHalf = Math.tan((60 * Math.PI) / 360);
        const ndcX = dot(delta, right) / (depth * tanHalf * (box.width / box.height));
        const ndcY = dot(delta, up) / (depth * tanHalf);
        x = box.x + ((ndcX + 1) / 2) * box.width;
        y = box.y + ((1 - ndcY) / 2) * box.height;
      }
      await page.mouse.move(x, y);
      await page.mouse.click(x, y);
    }

    async function check(mode: '2d' | '3d'): Promise<void> {
      const showDm = layers.getByRole('checkbox', { name: 'Show DM only' });
      const showTokens = layers.getByRole('checkbox', { name: 'Show Tokens' });
      await expect
        .poll(() => objectNames(page))
        .toEqual(expect.arrayContaining([dmToken, pcToken]));

      // Visible: a click on the centre picks the DM token.
      await pickToken(mode);
      await expect(selectedCard).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(selectedCard).toHaveCount(0);

      await showDm.click();
      await expect(showDm).not.toBeChecked();
      await expect.poll(() => objectNames(page)).not.toContain(dmToken);
      expect(await objectNames(page)).toContain(pcToken);
      // Picking skips it: the same click selects nothing.
      await pickToken(mode);
      await expect(selectedCard).toHaveCount(0);

      // Not only the DM layer: hiding Tokens removes the other token too.
      await showTokens.click();
      await expect.poll(() => objectNames(page)).not.toContain(pcToken);
      await showTokens.click();
      await expect.poll(() => objectNames(page)).toContain(pcToken);

      await showDm.click();
      await expect(showDm).toBeChecked();
      await expect.poll(() => objectNames(page)).toContain(dmToken);
      await pickToken(mode);
      await expect(selectedCard).toBeVisible();
      await page.keyboard.press('Escape');
    }

    await check('2d');
    await page.getByRole('button', { name: '3D view' }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () => (globalThis as unknown as { __mythicCamera?: object }).__mythicCamera !== undefined,
        ),
      )
      .toBe(true);
    await check('3d');
    expect(errors).toEqual([]);
  } finally {
    await setup.close();
    await context.close();
  }
});
