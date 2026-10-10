import { expect, test } from '@playwright/test';
import { RawClient, startTable, testUlid, type Table } from './harness.js';

// M2-08 (ENV-03, ENV-04): in 3D the selected prop shows the transform gizmo, and a typed
// elevation commits as one entity.update.

let table: Table;

test.beforeAll(async () => {
  table = await startTable();
});

test.afterAll(async () => {
  await table.stop();
});

interface Snapshot {
  activeSceneId: string;
  scenes: Record<string, { entities: Record<string, { transform: { position: { y: number } } }> }>;
}

test('selecting a prop in 3D mounts the gizmo without errors and a typed value commits', async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 1200, height: 850 } });
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
  await page.getByLabel('Prop name').fill('Crate');
  await page.getByRole('button', { name: 'Create prop' }).click();
  const list = page.getByRole('list', { name: 'Entities in this scene' });
  await list.getByRole('button', { name: 'Crate', exact: true }).click();

  await page.getByRole('button', { name: '3D view' }).click();
  const panel = page.getByRole('region', { name: /Transform: Crate/ });
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel(/^Y /)).toBeVisible();
  await page.waitForTimeout(500);

  const reader = await RawClient.connect(table, {
    name: 'reader',
    identityId: testUlid('READ', 1),
    identitySecret: 'reader-secret',
  });
  await reader.waitFor('snapshot', () => reader.state !== undefined);
  const elevation = () => {
    const s = reader.state as Snapshot;
    return Object.values(s.scenes[s.activeSceneId]?.entities ?? {})[0]?.transform.position.y;
  };

  const y = panel.getByLabel(/^Y /);
  await y.fill('abc');
  await y.press('Enter');
  await expect(panel.getByRole('alert')).toBeVisible();
  await y.fill('15');
  await y.press('Enter');
  await expect.poll(() => elevation(), { timeout: 10_000 }).toBeGreaterThan(0);

  expect(errors).toEqual([]);
  await reader.close();
  await context.close();
});
