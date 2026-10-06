import { expect, test } from '@playwright/test';
import { RawClient, startTable, testUlid, type Table } from './harness.js';

// M1-18 (TOK-02): dragging a selected token previews live to other clients (ephemeral relay) and
// commits ONE snapped token.move on drop; a token drag does not pan the camera.

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
    { entities: Record<string, { transform: { position: { x: number; y: number; z: number } } }> }
  >;
}

const HOST = { identityId: testUlid('HOST', 1), identitySecret: 'host-secret' };

test('host drags a token: others see the preview, the drop commits one snapped token.move', async ({
  browser,
}) => {
  const scene = testUlid('SCENE', 1);
  const token = testUlid('TOKEN', 1);
  const setup = await RawClient.connect(table, {
    name: 'host',
    ...HOST,
    hostToken: table.hostToken,
  });
  await setup.waitFor('snapshot', () => setup.state !== undefined);
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

  const observer = await RawClient.connect(table, {
    name: 'watcher',
    identityId: testUlid('WATCH', 1),
    identitySecret: 'watch-secret',
  });
  await observer.waitFor('snapshot', () => observer.state !== undefined);

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
  const zoom = Math.min(box.width / 42, box.height / 32);
  const at = (x: number, z: number) => ({
    x: box.x + box.width / 2 + (x - 20) * zoom,
    y: box.y + box.height / 2 + (z - 15) * zoom,
  });

  const panel = page.getByRole('region', { name: /Transform/ });
  const start = at(2.5, 3.5);
  await expect(async () => {
    await page.mouse.click(start.x, start.y);
    await expect(panel).toBeVisible({ timeout: 1000 });
  }).toPass();

  // Grab off-centre (a quarter cell from the middle) and drag 3 cells right, 2 down.
  const grab = { x: start.x + zoom * 0.3, y: start.y + zoom * 0.3 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + zoom, grab.y + zoom * 0.5, { steps: 6 });
  await page.mouse.move(grab.x + 3 * zoom, grab.y + 2 * zoom, { steps: 6 });
  await page.mouse.up();

  const position = () => {
    const s = observer.state as Snapshot;
    return s.scenes[scene]?.entities[token]?.transform.position;
  };
  await expect.poll(() => position()?.x, { timeout: 10_000 }).toBeCloseTo(5.5);
  expect(position()?.z).toBeCloseTo(5.5);
  expect(position()?.y).toBe(0);

  // A second client saw the live preview (relayed, attributed to the host identity).
  const previews = observer.frames
    .map((f) => JSON.parse(f) as { t: string; channel?: string; from?: string; data?: unknown })
    .filter((m) => m.t === 'ephemeral' && m.channel === 'token.drag-preview');
  expect(previews.length).toBeGreaterThan(0);
  expect(previews.every((m) => m.from === HOST.identityId)).toBe(true);

  expect(errors).toEqual([]);
  await observer.close();
  await context.close();
});
