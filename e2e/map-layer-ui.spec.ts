import { expect, test } from '@playwright/test';
import { RawClient, startTable, testUlid, type Table } from './harness.js';

let table: Table | undefined;
const HOST = { identityId: testUlid('HOST', 43), identitySecret: 'map-layer-host-secret' };

test.beforeAll(async () => {
  table = await startTable();
});

test.afterAll(async () => {
  await table?.stop();
});

test('the map layer is explained, selectable for fixed objects, and shown on battlemaps', async ({
  browser,
}) => {
  if (!table) throw new Error('table not started');
  const seededHost = await RawClient.connect(table, {
    name: 'map-layer-host',
    ...HOST,
    hostToken: table.hostToken,
  });
  await seededHost.waitFor('snapshot', () => seededHost.state !== undefined);
  const sceneId = testUlid('SCENE', 43);
  await seededHost.intent('scene.create', { sceneId, name: 'Map layer test' });
  await seededHost.intent('scene.activate', { sceneId });
  // Seed a battlemap through the action pipeline; this regression exercises panel selection,
  // while image upload authorization has its own integration coverage.
  await seededHost.intent('entity.create', {
    sceneId,
    entity: {
      id: testUlid('MAP', 43),
      name: 'Dungeon floor',
      layer: 'map',
      owners: [],
      transform: {
        position: { x: 20, y: 0, z: 15 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
      },
      image: {
        asset: { source: 'local', hash: 'a'.repeat(64), kind: 'image', name: 'Dungeon floor' },
        calibrated: false,
      },
    },
  });
  await seededHost.close();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript((identity) => {
    localStorage.setItem('mythic.identity.v1', JSON.stringify(identity));
    localStorage.setItem('mythic.host', '1');
  }, HOST);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto(table.clientUrl);
  await expect(page.getByRole('status')).toHaveText('Connected to New campaign');

  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  const layers = page.getByRole('region', { name: 'Layers' });
  await expect(
    layers.getByText('Battlemap images, ground, terrain and fixed objects'),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await expect(page.getByRole('form', { name: 'Create token' }).getByLabel('Layer')).toContainText(
    'Map',
  );
  const propForm = page.getByRole('form', { name: 'Create prop' });
  await propForm.getByLabel('Layer').selectOption('map');
  await propForm.getByLabel('Prop name').fill('Fixed wall');
  await propForm.getByRole('button', { name: 'Create prop' }).click();
  const entityList = page.getByRole('list', { name: 'Entities in this scene' });
  const fixedWall = entityList.getByRole('listitem').filter({ hasText: 'Fixed wall' });
  await expect(fixedWall.getByText('Map', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Map', exact: true }).click();
  const mapPanel = page.getByRole('region', { name: 'Battlemap' });
  await expect(mapPanel).toContainText(
    'Battlemaps are placed on the Map layer, below tokens and movable props.',
  );
  const battlemap = mapPanel.getByRole('button', { name: 'Dungeon floor', exact: true });
  await expect(battlemap).toBeVisible();
  await expect(mapPanel.getByText('Map layer', { exact: true })).toBeVisible();
  await battlemap.click();
  await expect(battlemap).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('region', { name: 'Transform: Dungeon floor' })).toBeVisible();

  expect(errors).toEqual([]);
  await context.close();
});
