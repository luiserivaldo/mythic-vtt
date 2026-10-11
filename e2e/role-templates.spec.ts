import { expect, test } from '@playwright/test';
import { RawClient, recordPageFrames, startTable, testUlid, type Table } from './harness.js';

let table: Table | undefined;

test.beforeAll(async () => {
  table = await startTable();
});
test.afterAll(async () => {
  await table?.stop();
});

test('the DM adds role templates and the spectator preset receives a read-only player view', async ({
  browser,
}) => {
  if (!table) throw new Error('table not started');
  const dmContext = await browser.newContext();
  const dm = await dmContext.newPage();
  const errors: string[] = [];
  dm.on('pageerror', (error) => errors.push(error.message));
  await dm.goto(`${table.clientUrl.replace(/\/$/, '')}/#host=${table.hostToken}`);
  await expect(dm.getByRole('status')).toHaveText('Connected to New campaign');
  await dm.getByRole('button', { name: 'Participants' }).click();

  for (const label of ['DM / Admin', 'Co-DM', 'Player', 'Spectator']) {
    await dm.getByRole('button', { name: `Add ${label}` }).click();
    await expect(
      dm.getByRole('listitem', { name: `${label} participant`, exact: true }),
    ).toHaveCount(1);
  }
  const spectatorRow = dm.getByRole('listitem', {
    name: 'Spectator participant',
    exact: true,
  });
  await expect(spectatorRow.getByLabel('Access role')).toHaveValue('player');
  await expect(spectatorRow.getByRole('checkbox', { name: 'view' })).toBeChecked();
  for (const permission of ['move', 'edit', 'delete'])
    await expect(spectatorRow.getByRole('checkbox', { name: permission })).not.toBeChecked();

  const hostIdentity = await dm.evaluate(
    () =>
      JSON.parse(localStorage.getItem('mythic.identity.v1') ?? '{}') as {
        identityId: string;
        identitySecret: string;
      },
  );
  const setup = await RawClient.connect(table, { name: 'role-template-setup', ...hostIdentity });
  await setup.waitFor('host snapshot', () => setup.state !== undefined);
  const sceneId = testUlid('SCENE', 144);
  const publicId = testUlid('PUBLIC', 144);
  const secretId = testUlid('SECRET', 144);
  const transform = (x: number, z: number) => ({
    position: { x, y: 0, z },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  });
  expect((await setup.intent('scene.create', { sceneId, name: 'Template permissions' })).t).toBe(
    'ack',
  );
  for (const entity of [
    {
      id: publicId,
      layer: 'tokens',
      name: 'PUBLIC TOKEN',
      owners: [],
      transform: transform(10, 10),
      token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
    },
    {
      id: secretId,
      layer: 'dm',
      name: 'SECRET TEMPLATE TOKEN',
      owners: [],
      transform: transform(12, 10),
      token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
    },
  ])
    expect((await setup.intent('entity.create', { sceneId, entity })).t).toBe('ack');

  const viewerContext = await browser.newContext();
  const viewer = await viewerContext.newPage();
  const frames = recordPageFrames(viewer);
  viewer.on('pageerror', (error) => errors.push(error.message));
  await viewer.goto(table.clientUrl);
  await viewer.getByLabel('Display name').fill('Read Only Guest');
  await viewer.getByRole('button', { name: 'Continue' }).click();
  await viewer.getByRole('radio', { name: /Spectator/ }).check();
  await viewer.getByRole('button', { name: 'Join participant slot' }).click();
  await expect(viewer.getByRole('status')).toHaveText('Connected to New campaign');
  await expect(viewer.getByTestId('token-label').filter({ hasText: 'PUBLIC TOKEN' })).toBeVisible();
  await expect(viewer.getByText('SECRET TEMPLATE TOKEN')).toHaveCount(0);
  await expect(viewer.getByRole('button', { name: 'Multi-select' })).toHaveCount(0);
  await expect(viewer.getByRole('button', { name: 'Ruler' })).toHaveCount(0);
  await expect(viewer.getByRole('button', { name: 'AoE placement' })).toHaveCount(0);
  await expect(viewer.getByRole('button', { name: 'Apply' })).toHaveCount(0);
  await expect(viewer.getByRole('button', { name: '3D view' })).toBeVisible();
  expect(frames.join('\n')).toContain('PUBLIC TOKEN');
  expect(frames.join('\n')).not.toContain(secretId);
  expect(frames.join('\n')).not.toContain('SECRET TEMPLATE TOKEN');
  expect(errors).toEqual([]);

  await setup.close();
  await viewerContext.close();
  await dmContext.close();
});
