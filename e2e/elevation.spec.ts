import { expect, test } from '@playwright/test';
import { RawClient, startTable, testUlid, type Table } from './harness.js';

// M2-01 (TOK-03): the host selects a token, raises it with the +/- controls and the numeric
// field, and the 2D HTML badge shows the elevation in scene units; ground level shows no badge.

let table: Table;

test.beforeAll(async () => {
  table = await startTable();
});

test.afterAll(async () => {
  await table.stop();
});

interface Snapshot {
  scenes: Record<string, { entities: Record<string, { transform: { position: { y: number } } }> }>;
}

const HOST = { identityId: testUlid('HOST', 1), identitySecret: 'host-secret' };

test('host sets elevation through the panel and sees the badge in scene units', async ({
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
  await setup.intent('scene.create', { sceneId: scene, name: 'Tower' });
  await setup.intent('scene.activate', { sceneId: scene });
  await setup.intent('entity.create', {
    sceneId: scene,
    entity: {
      id: token,
      layer: 'tokens',
      name: 'Archer',
      owners: [],
      transform: {
        position: { x: 2.5, y: 0, z: 3.5 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
      },
      token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
    },
  });
  const y = () => (setup.state as Snapshot).scenes[scene]?.entities[token]?.transform.position.y;

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
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas box');
  const zoom = Math.min(box.width / 42, box.height / 32);
  const click = {
    x: box.x + box.width / 2 + (2.5 - 20) * zoom,
    y: box.y + box.height / 2 + (3.5 - 15) * zoom,
  };

  const panel = page.getByRole('region', { name: /Transform/ });
  await expect(async () => {
    await page.mouse.click(click.x, click.y);
    await expect(panel).toBeVisible({ timeout: 1000 });
  }).toPass();

  const badge = page.getByTestId('elevation-badge');
  await expect(badge).toHaveCount(0);

  await panel.getByRole('button', { name: 'Raise elevation' }).click();
  await expect.poll(y, { timeout: 10_000 }).toBe(1);
  await expect(badge).toHaveText('+5 ft');

  await panel.getByRole('button', { name: 'Raise elevation' }).click({ modifiers: ['Shift'] });
  await expect.poll(y, { timeout: 10_000 }).toBe(5);
  await expect(badge).toHaveText('+25 ft');

  const field = panel.getByRole('textbox', { name: /^Elevation/ });
  await field.fill('-10');
  await field.press('Enter');
  await expect.poll(y, { timeout: 10_000 }).toBe(-2);
  await expect(badge).toHaveText('-10 ft');

  await field.fill('0');
  await field.press('Enter');
  await expect.poll(y, { timeout: 10_000 }).toBe(0);
  await expect(badge).toHaveCount(0);

  expect(errors).toEqual([]);
  await setup.close();
  await context.close();
});
