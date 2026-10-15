import { expect, test } from '@playwright/test';
import { RawClient, startTable, testUlid, type Table } from './harness.js';

// M1-20 / M1-35 (ENV-03, TOK-09), UI-TOKEN-07: the 2D transform gizmo moves a token along the X
// and Z arrows, turns it with the Y ring and uniformly resizes it with a corner square, without
// panning the camera; typed values validate and use token.sizeCells as the size source.

let table: Table;

test.beforeAll(async () => {
  table = await startTable();
});

test.afterAll(async () => {
  await table.stop();
});

interface Snapshot {
  scenes: Record<
    string,
    {
      grid: { unitsPerCell: number };
      entities: Record<
        string,
        {
          transform: {
            position: { x: number; z: number };
            rotation?: { x: number; y: number; z: number; w: number };
            scale: { x: number; y: number; z: number };
          };
          token?: { sizeCells: number };
        }
      >;
    }
  >;
}

const HOST = { identityId: testUlid('HOST', 1), identitySecret: 'host-secret' };

async function hostClient(withToken: boolean): Promise<RawClient> {
  const client = await RawClient.connect(table, {
    name: 'host',
    ...HOST,
    ...(withToken ? { hostToken: table.hostToken } : {}),
  });
  await client.waitFor('snapshot', () => client.state !== undefined);
  return client;
}

test('host drives every 2D handle type on a token and types values', async ({ browser }) => {
  const scene = testUlid('SCENE', 1);
  const token = testUlid('TOKEN', 1);
  const setup = await hostClient(true);
  await setup.intent('scene.create', { sceneId: scene, name: 'Crypt' });
  await setup.intent('scene.activate', { sceneId: scene });
  await setup.intent('entity.create', {
    sceneId: scene,
    entity: {
      id: token,
      layer: 'tokens',
      name: 'Goblin',
      owners: [],
      transform: {
        position: { x: 2.5, y: 0, z: 3.5 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
      },
      token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
    },
  });
  await setup.close();

  // The browser reuses the host identity (the gateway keeps recognising it) so it sees host UI.
  const context = await browser.newContext();
  await context.addInitScript((identity) => {
    localStorage.setItem('mythic.identity.v1', JSON.stringify(identity));
    localStorage.setItem('mythic.host', '1');
  }, HOST);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(table.clientUrl);

  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId('token-label')).toHaveText('Goblin');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas box');
  // D37: the 2D view opens framing the whole default 40 x 30 canvas (1 cell padding): the
  // canvas centre is at the viewport centre and zoom fits the padded canvas.
  const zoom = Math.min(box.width / 42, box.height / 32);
  const at = (x: number, z: number) => ({
    x: box.x + box.width / 2 + (x - 20) * zoom,
    y: box.y + box.height / 2 + (z - 15) * zoom,
  });

  const panel = page.getByRole('region', { name: /Transform/ });
  await expect(panel).toHaveCount(0);
  const start = at(2.5, 3.5);
  // The view frames the canvas once the orthographic camera mounts, so retry the click until then.
  await expect(async () => {
    await page.mouse.click(start.x, start.y);
    await expect(panel).toBeVisible({ timeout: 1000 });
  }).toPass();

  const labelBefore = await page.getByTestId('token-label').boundingBox();

  // Drag the move handle (token centre) two cells right; the camera must not pan.
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + zoom, start.y, { steps: 4 });
  await page.mouse.move(start.x + 2 * zoom, start.y, { steps: 4 });
  await page.mouse.up();

  const reader = await hostClient(false);
  const position = () => {
    const s = reader.state as Snapshot;
    return s.scenes[scene]?.entities[token]?.transform.position;
  };
  await expect.poll(() => position()?.x, { timeout: 10_000 }).toBeCloseTo(4.5);
  expect(position()?.z).toBeCloseTo(3.5);
  // The token is still selected (the drag's click was swallowed) and the gizmo follows it.
  await expect(panel).toBeVisible();

  // UI-TOKEN-07 handles (px from the token centre, 1-cell token): the Y ring circles the
  // footprint 14 px outside its corners; the X/Z arrows run from 6 to 44 px outside the ring.
  const drag = async (
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): Promise<void> => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
  };
  const ring = Math.hypot(0.5, 0.5) * zoom + 14;
  const arrowMid = ring + 25;
  const entityState = () => (reader.state as Snapshot).scenes[scene]?.entities[token];

  // Red X arrow: moves along X only.
  let c = at(4.5, 3.5);
  await drag({ x: c.x + arrowMid, y: c.y }, { x: c.x + arrowMid + 2 * zoom, y: c.y + 0.4 * zoom });
  await expect.poll(() => position()?.x, { timeout: 10_000 }).toBeCloseTo(6.5);
  expect(position()?.z).toBeCloseTo(3.5);

  // Blue Z arrow: moves along Z only (screen down).
  c = at(6.5, 3.5);
  await drag({ x: c.x, y: c.y + arrowMid }, { x: c.x + 0.4 * zoom, y: c.y + arrowMid + zoom });
  await expect.poll(() => position()?.z, { timeout: 10_000 }).toBeCloseTo(4.5);
  expect(position()?.x).toBeCloseTo(6.5);

  // Green Y ring: from the ring's left point a quarter turn round to its bottom point turns the
  // token +90 degrees about Y (three.js sense), committed as a quaternion.
  c = at(6.5, 4.5);
  await drag({ x: c.x - ring, y: c.y }, { x: c.x, y: c.y + ring });
  await expect
    .poll(() => entityState()?.transform.rotation?.y, { timeout: 10_000 })
    .toBeCloseTo(Math.SQRT1_2, 3);
  expect(entityState()?.transform.rotation?.w).toBeCloseTo(Math.SQRT1_2, 3);
  expect(position()).toMatchObject({ x: 6.5, z: 4.5 });

  // M1-35: a corner square resizes token.sizeCells, not transform.scale. The square sits on the
  // footprint corner (turned with the token), so press the corner and drag out to double.
  const corner = { x: c.x + zoom / 2, y: c.y + zoom / 2 };
  await drag(corner, { x: c.x + zoom, y: c.y + zoom });
  await expect.poll(() => entityState()?.token?.sizeCells, { timeout: 10_000 }).toBe(2);
  expect(entityState()?.transform.scale).toEqual({ x: 1, y: 1, z: 1 });
  expect(position()).toMatchObject({ x: 6.5, z: 4.5 });
  await expect(panel.getByLabel('Size (cells)')).toHaveValue('2');
  const resized = entityState;

  // Dragging empty board still pans (the label moves on screen).
  const empty = at(10, 8);
  await page.mouse.move(empty.x, empty.y);
  await page.mouse.down();
  await page.mouse.move(empty.x + 60, empty.y, { steps: 5 });
  await page.mouse.up();
  const labelAfterPan = await page.getByTestId('token-label').boundingBox();
  expect(labelAfterPan?.x).toBeGreaterThan((labelBefore?.x ?? 0) + 2 * zoom);

  // Typed values: invalid input is rejected locally, valid input is one commit.
  const unitsPerCell = (reader.state as Snapshot).scenes[scene]?.grid.unitsPerCell ?? 1;
  const xField = panel.getByLabel(/^X/);
  await xField.fill('abc');
  await xField.press('Enter');
  await expect(panel.getByRole('alert')).toContainText('Enter a number');
  await xField.fill(String(7.5 * unitsPerCell));
  await xField.press('Enter');
  await expect.poll(() => position()?.x, { timeout: 10_000 }).toBeCloseTo(7.5);

  // Typed size uses the same source of truth and remains available to 3D rendering.
  const sizeField = panel.getByLabel('Size (cells)');
  const applyButton = panel.getByRole('button', { name: 'Apply' });
  await expect(applyButton).toBeEnabled();
  await sizeField.fill('3');
  await expect(sizeField).toHaveValue('3');
  await applyButton.click();
  await expect.poll(() => resized()?.token?.sizeCells, { timeout: 10_000 }).toBe(3);
  expect(resized()?.transform.scale).toEqual({ x: 1, y: 1, z: 1 });

  expect(errors).toEqual([]);
  await reader.close();
  await context.close();
});
