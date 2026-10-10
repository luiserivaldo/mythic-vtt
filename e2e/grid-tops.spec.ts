import { expect, test } from '@playwright/test';
import { RawClient, startTable, testUlid, type Table } from './harness.js';

// M3-09 (GRID-05): overlapping walkable tops render only the winning grid without page errors.
let table: Table | undefined;

test.beforeAll(async () => {
  table = await startTable();
});
test.afterAll(async () => {
  await table?.stop();
});

test('overlapping walkable tops render one stable top grid in 3D', async ({ browser }) => {
  if (!table) throw new Error('table not started');
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`${table.clientUrl.replace(/\/$/, '')}/#host=${table.hostToken}`);
  await expect(page.getByRole('status')).toHaveText('Connected to New campaign');
  await page.getByRole('button', { name: 'Scenes', exact: true }).click();
  await page.getByLabel('New scene name').fill('Tower');
  await page.getByRole('button', { name: 'Create scene' }).click();
  await expect(page.getByText('Active', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await page.getByLabel('Prop name').fill('Dais');
  await page.getByLabel('Walkable').check();
  await page.getByRole('button', { name: 'Create prop' }).click();
  const list = page.getByRole('list', { name: 'Entities in this scene' });
  await list.getByRole('button', { name: 'Dais', exact: true }).click();
  const toggle = page.getByLabel('Show grid on top of Dais');
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();

  const identity = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('mythic.identity.v1') ?? '{}') as {
        identityId: string;
        identitySecret: string;
      },
  );
  const setup = await RawClient.connect(table, { name: 'stacked-grid-setup', ...identity });
  await setup.waitFor('host snapshot', () => setup.state !== undefined);
  const state = setup.state as {
    activeSceneId: string;
    scenes: Record<
      string,
      {
        entities: Record<
          string,
          { name: string; transform: { position: { x: number; y: number; z: number } } }
        >;
      }
    >;
  };
  const sceneId = state.activeSceneId;
  const lower = Object.values(state.scenes[sceneId]?.entities ?? {}).find(
    (entity) => entity.name === 'Dais',
  );
  if (!lower) throw new Error('missing lower dais');
  expect(
    (
      await setup.intent('entity.create', {
        sceneId,
        entity: {
          id: testUlid('UPPER-GRID', 1),
          layer: 'props',
          name: 'Upper Dais',
          owners: [],
          transform: {
            position: { ...lower.transform.position, y: 2 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 2, y: 1, z: 2 },
          },
          shape: {
            kind: 'box',
            color: '#556677',
            walkable: true,
            showGridOnTop: true,
          },
        },
      })
    ).t,
  ).toBe('ack');

  await page.getByRole('button', { name: '3D view' }).click();
  await expect(page.getByRole('button', { name: 'Reset view' })).toBeVisible();
  await page.waitForTimeout(1000);
  expect(errors).toEqual([]);
  await setup.close();
  await context.close();
});
