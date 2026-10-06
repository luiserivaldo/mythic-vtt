import { expect, test } from '@playwright/test';
import { RawClient, startTable, testUlid, type Table } from './harness.js';

// M1-20 (ENV-03): the 2D transform gizmo mounts for the host, a handle drag commits one snapped
// entity.update without panning the camera, and typed values validate before they are sent.

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
      entities: Record<string, { transform: { position: { x: number; z: number } } }>;
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

test('host selects a token, drags its move handle and types values', async ({ browser }) => {
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
  const zoom = 48; // default 2D zoom: px per cell, world origin at the canvas centre
  const at = (x: number, z: number) => ({
    x: box.x + box.width / 2 + x * zoom,
    y: box.y + box.height / 2 + z * zoom,
  });

  const panel = page.getByRole('region', { name: /Transform/ });
  await expect(panel).toHaveCount(0);
  const start = at(2.5, 3.5);
  await page.mouse.click(start.x, start.y);
  await expect(panel).toBeVisible();

  const labelBefore = await page.getByTestId('token-label').boundingBox();

  // Drag the move handle (token centre) two cells right; the camera must not pan.
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 48, start.y, { steps: 4 });
  await page.mouse.move(start.x + 96, start.y, { steps: 4 });
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

  // Dragging empty board still pans (the label moves on screen).
  const empty = at(-4, -3);
  await page.mouse.move(empty.x, empty.y);
  await page.mouse.down();
  await page.mouse.move(empty.x + 60, empty.y, { steps: 5 });
  await page.mouse.up();
  const labelAfterPan = await page.getByTestId('token-label').boundingBox();
  expect(labelAfterPan?.x).toBeGreaterThan((labelBefore?.x ?? 0) + 96);

  // Typed values: invalid input is rejected locally, valid input is one commit.
  const unitsPerCell = (reader.state as Snapshot).scenes[scene]?.grid.unitsPerCell ?? 1;
  const xField = panel.getByLabel(/^X/);
  await xField.fill('abc');
  await xField.press('Enter');
  await expect(panel.getByRole('alert')).toContainText('Enter a number');
  await xField.fill(String(7.5 * unitsPerCell));
  await xField.press('Enter');
  await expect.poll(() => position()?.x, { timeout: 10_000 }).toBeCloseTo(7.5);

  expect(errors).toEqual([]);
  await reader.close();
  await context.close();
});
