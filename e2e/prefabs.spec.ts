import { expect, test } from '@playwright/test';
import { Campaign } from '../packages/shared/src/index.js';
import { RawClient, startTable, testUlid, type Table } from './harness.js';
let table: Table;
test.beforeAll(async () => {
  table = await startTable();
});
test.afterAll(async () => {
  await table.stop();
});
test('DM saves a private library and places independent configured copies across scenes', async ({
  browser,
}) => {
  const identity = { identityId: testUlid('HOST', 1), identitySecret: 'prefab-host' };
  const host = await RawClient.connect(table, {
    name: 'DM',
    ...identity,
    hostToken: table.hostToken,
  });
  const sceneId = testUlid('SCENE', 1),
    targetId = testUlid('SCENE', 2),
    entityId = testUlid('PROP', 1),
    secretId = testUlid('PROP', 2);
  for (const [id, name] of [
    [sceneId, 'Workshop'],
    [targetId, 'Dungeon'],
  ])
    expect(await host.intent('scene.create', { sceneId: id, name })).toMatchObject({ t: 'ack' });
  expect(await host.intent('scene.activate', { sceneId })).toMatchObject({ t: 'ack' });
  for (const [id, name, layer] of [
    [entityId, 'Stone pillar', 'props'],
    [secretId, 'Secret pillar', 'dm'],
  ] as const)
    expect(
      await host.intent('entity.create', {
        sceneId,
        entity: {
          id,
          name,
          layer,
          owners: [],
          transform: {
            position: { x: 5, y: 0, z: 5 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 2, y: 3, z: 2 },
          },
          shape: { kind: 'cylinder', color: '#8090ff', walkable: true },
        },
      }),
    ).toMatchObject({ t: 'ack' });
  const observer = await RawClient.connect(table, {
    name: 'Spectator',
    identityId: testUlid('OBSERVER', 1),
    identitySecret: 'prefab-observer',
  });
  await observer.waitFor('snapshot', () => observer.state !== undefined);
  const context = await browser.newContext();
  await context.addInitScript((value) => {
    localStorage.setItem('mythic.identity.v1', JSON.stringify(value));
    localStorage.setItem('mythic.host', '1');
  }, identity);
  const page = await context.newPage(),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(table.clientUrl);
  await page.getByRole('button', { name: 'Prefabs', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Prefab library' });
  await panel.getByLabel('Source entity').selectOption(entityId);
  await panel.getByLabel('Prefab name').fill('Private library template');
  await panel.getByRole('button', { name: 'Save prefab' }).click();
  await expect(panel.getByLabel('Saved prefab').locator('option')).toHaveCount(2);
  const state = () => Campaign.parse(host.state),
    prefab = () => Object.values(state().prefabs ?? {})[0];
  await host.waitFor('saved prefab', () => !!prefab());
  const saved = prefab();
  if (!saved) throw new Error('prefab');
  await observer.waitForSeq(host.lastSeq);
  expect(Campaign.parse(observer.state).prefabs).toBeUndefined();
  expect(JSON.stringify(observer.frames)).not.toContain('Private library template');
  expect(JSON.stringify(observer.frames)).not.toContain(saved.id);
  expect(
    await observer.intent('prefab.place', {
      sceneId: targetId,
      prefabId: saved.id,
      entityId: testUlid('COPY', 1),
      to: { x: 10, y: 0, z: 10 },
    }),
  ).toMatchObject({ t: 'reject' });
  await panel.getByLabel('Saved prefab').selectOption(saved.id);
  await panel.getByLabel('Target scene').selectOption(targetId);
  await panel.getByLabel('Prefab X (ft)').fill('50');
  await panel.getByLabel('Prefab Z (ft)').fill('50');
  await panel.getByRole('button', { name: 'Place copy' }).click();
  await host.waitFor(
    'first copy',
    () => Object.keys(state().scenes[targetId]?.entities ?? {}).length === 1,
  );
  await panel.getByLabel('Prefab X (ft)').fill('60');
  await panel.getByRole('button', { name: 'Place copy' }).click();
  await host.waitFor(
    'second copy',
    () => Object.keys(state().scenes[targetId]?.entities ?? {}).length === 2,
  );
  const copies = Object.values(state().scenes[targetId]?.entities ?? {});
  expect(copies.map((e) => e.transform.position.x).sort((a, b) => a - b)).toEqual([10, 12]);
  for (const copy of copies) {
    expect(copy.transform.scale).toEqual({ x: 2, y: 3, z: 2 });
    expect(copy.shape).toMatchObject({ kind: 'cylinder', walkable: true, color: '#8090ff' });
    expect(copy.owners).toEqual([]);
  }
  const first = copies[0];
  if (!first) throw new Error('copy');
  expect(
    await host.intent('entity.update', {
      sceneId: targetId,
      entityId: first.id,
      changes: { name: 'Changed instance' },
    }),
  ).toMatchObject({ t: 'ack' });
  expect(prefab()?.entity.name).toBe('Stone pillar');
  await panel.getByLabel('Source entity').selectOption(secretId);
  await panel.getByLabel('Prefab name').fill('Hidden blueprint');
  await panel.getByRole('button', { name: 'Save prefab' }).click();
  await host.waitFor('secret blueprint', () => Object.keys(state().prefabs ?? {}).length === 2);
  await observer.waitForSeq(host.lastSeq);
  expect(JSON.stringify(observer.frames)).not.toContain('Hidden blueprint');
  expect(JSON.stringify(observer.frames)).not.toContain('Secret pillar');
  expect(await host.intent('scene.activate', { sceneId: targetId })).toMatchObject({ t: 'ack' });
  await page.getByRole('button', { name: 'Close Prefabs panel' }).click();
  await page.getByRole('button', { name: '3D view', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reset view' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Prefabs', exact: true }).click();
  await expect(panel.getByLabel('Saved prefab').locator('option')).toHaveCount(3);
  await panel.getByLabel('Saved prefab').selectOption(saved.id);
  await panel.getByRole('button', { name: 'Delete prefab' }).click();
  await host.waitFor('template removed', () => state().prefabs?.[saved.id] === undefined);
  expect(Object.keys(state().scenes[targetId]?.entities ?? {})).toHaveLength(2);
  expect(errors).toEqual([]);
  await context.close();
  await host.close();
  await observer.close();
});

test('co-DM never receives or instantiates a prefab whose source view is denied', async () => {
  const host = await RawClient.connect(table, {
    name: 'DM',
    identityId: testUlid('HOST', 1),
    identitySecret: 'prefab-host',
  });
  const sceneId = testUlid('SCENE', 3),
    entityId = testUlid('PROP', 3),
    prefabId = testUlid('PREFAB', 3),
    seatId = testUlid('SEAT', 3);
  const identity = { identityId: testUlid('CODM', 3), identitySecret: 'prefab-codm' };
  expect(
    await host.intent('scene.create', { sceneId, name: 'Private configuration' }),
  ).toMatchObject({ t: 'ack' });
  expect(await host.intent('seat.create', { seatId, label: 'Co-DM', role: 'codm' })).toMatchObject({
    t: 'ack',
  });
  expect(
    await host.intent('seat.assign', { seatId, identityId: identity.identityId }),
  ).toMatchObject({ t: 'ack' });
  expect(
    await host.intent('entity.create', {
      sceneId,
      entity: {
        id: entityId,
        name: 'Restricted pillar',
        layer: 'props',
        owners: [],
        perms: { view: false },
        transform: {
          position: { x: 5, y: 0, z: 5 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          scale: { x: 1, y: 1, z: 1 },
        },
        shape: { kind: 'cylinder', color: '#8090ff', walkable: true },
      },
    }),
  ).toMatchObject({ t: 'ack' });
  const coDm = await RawClient.connect(table, { name: 'Co-DM', ...identity });
  await coDm.waitFor('co-DM snapshot', () => coDm.state !== undefined);
  const save = { sceneId, entityId, prefabId, name: 'Restricted blueprint' };
  expect(await host.intent('prefab.save', save)).toMatchObject({ t: 'ack' });
  await coDm.waitForSeq(host.lastSeq);
  expect(JSON.stringify(coDm.frames)).not.toMatch(/Restricted pillar|Restricted blueprint/);
  expect(JSON.stringify(coDm.frames)).not.toContain(prefabId);
  expect(Campaign.parse(coDm.state).prefabs?.[prefabId]).toBeUndefined();
  expect(
    await coDm.intent('prefab.save', { ...save, prefabId: testUlid('PREFAB', 4) }),
  ).toMatchObject({ t: 'reject' });
  expect(
    await coDm.intent('prefab.place', {
      sceneId,
      prefabId,
      entityId: testUlid('COPY', 4),
      to: { x: 10, y: 0, z: 10 },
    }),
  ).toMatchObject({ t: 'reject' });
  expect(await coDm.intent('prefab.remove', { prefabId })).toMatchObject({ t: 'reject' });
  expect(Campaign.parse(host.state).prefabs?.[prefabId]).toBeDefined();
  await host.close();
  await coDm.close();
});
