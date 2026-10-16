import { settledCellToPixel } from './board-map.js';
import { expect, test } from '@playwright/test';
import { RawClient, startTable, testUlid, type Table } from './harness.js';

// M2-14 (TOK-03, ENV-04, Q26): moving an elevated token keeps its height unless it is dropped onto a
// walkable surface under the cursor; a flying token never changes height. A middle click on a
// selected token toggles the lock, anyone who can see the token sees the flag, and a spectator
// cannot change it.

let table: Table | undefined;

test.beforeAll(async () => {
  table = await startTable();
});

test.afterAll(async () => {
  await table?.stop();
});

interface Snapshot {
  scenes: Record<
    string,
    {
      entities: Record<
        string,
        {
          transform: { position: { x: number; y: number; z: number } };
          token?: { flying?: boolean };
        }
      >;
    }
  >;
}

test('elevated tokens keep their height; flying locks it; a spectator cannot toggle', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  if (!table) throw new Error('table not started');
  // Wide enough that the open left pane (UI-TOKEN-07) leaves the board as wide as a 1280 px
  // window without it, so the token near the board's left edge stays clear of the floating rail.
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${table.clientUrl.replace(/\/$/, '')}/#host=${table.hostToken}`);
  await expect(page.getByRole('status')).toHaveText('Connected to New campaign');
  const identity = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('mythic.identity.v1') ?? '{}') as {
        identityId: string;
        identitySecret: string;
      },
  );
  const host = await RawClient.connect(table, { name: 'flying host', ...identity });
  await host.waitFor('host snapshot', () => host.state !== undefined);

  const sceneId = testUlid('SCENE', 61);
  const tokenId = testUlid('TOKEN', 61);
  const platformId = testUlid('PLATFORM', 61);
  expect((await host.intent('scene.create', { sceneId, name: 'Flying' })).t).toBe('ack');
  expect((await host.intent('scene.activate', { sceneId })).t).toBe('ack');
  const rotation = { x: 0, y: 0, z: 0, w: 1 };
  expect(
    (
      await host.intent('entity.create', {
        sceneId,
        entity: {
          id: platformId,
          layer: 'props',
          name: 'Dais',
          owners: [],
          transform: {
            position: { x: 12, y: 0, z: 4 },
            rotation,
            scale: { x: 4, y: 2, z: 4 },
          },
          shape: { kind: 'box', color: '#888888', walkable: true },
        },
      })
    ).t,
  ).toBe('ack');
  expect(
    (
      await host.intent('entity.create', {
        sceneId,
        entity: {
          id: tokenId,
          layer: 'tokens',
          name: 'Harpy',
          owners: [],
          transform: {
            position: { x: 2.5, y: 3, z: 3.5 },
            rotation,
            scale: { x: 1, y: 1, z: 1 },
          },
          token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
        },
      })
    ).t,
  ).toBe('ack');

  const entity = () => (host.state as Snapshot).scenes[sceneId]?.entities[tokenId];
  const position = () => entity()?.transform.position;
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  let screen = await settledCellToPixel(page);
  const drag = async (from: { x: number; z: number }, to: { x: number; z: number }) => {
    const a = screen(from.x, from.z);
    const b = screen(to.x, to.z);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
  };

  // The host state updates before the client has redrawn the token. Under load the next click can
  // land on the old spot, so wait until the rendered label sits over the expected cell.
  const label = page.getByTestId('token-label').filter({ hasText: 'Harpy' });
  const rendered = async (x: number, z: number) => {
    await expect
      .poll(
        async () => {
          const b = await label.boundingBox();
          return b ? Math.abs(b.x + b.width / 2 - screen(x, z).x) : Infinity;
        },
        { timeout: 15_000 },
      )
      .toBeLessThan(6);
  };

  const panel = page.getByRole('region', { name: 'Transform: Harpy' });
  // UI-TOKEN-07 (MV-266): a selected token shows its Transform panel in the left pane.
  const start = screen(2.5, 3.5);
  await expect(async () => {
    await page.mouse.click(start.x, start.y);
    await expect(panel).toBeVisible({ timeout: 1000 });
  }).toPass();
  // Map scene cells once the board's framing has settled.
  screen = await settledCellToPixel(page);

  // 1. Moving over bare ground keeps the height (it used to fall to the ground).
  await drag({ x: 2.5, z: 3.5 }, { x: 6.5, z: 3.5 });
  await expect.poll(() => position()?.x, { timeout: 10_000 }).toBeCloseTo(6.5);
  expect(position()?.y).toBe(3);
  await rendered(6.5, 3.5);

  // 2. Dropping on the platform lands on its top, even though the token is higher.
  await drag({ x: 6.5, z: 3.5 }, { x: 12.5, z: 4.5 });
  await expect.poll(() => position()?.y, { timeout: 10_000 }).toBe(2);
  await rendered(12.5, 4.5);

  // 3. A middle click on the selected token locks its height; a middle drag still pans.
  const onDais = screen(12.5, 4.5);
  await page.mouse.click(onDais.x, onDais.y, { button: 'middle' });
  await expect.poll(() => entity()?.token?.flying, { timeout: 10_000 }).toBe(true);
  await expect(page.getByTestId('elevation-badge')).toContainText('Flying');
  await expect(panel.getByRole('checkbox', { name: 'Flying' })).toBeChecked();

  // 4. A flying token ignores the platform and keeps its height when moved off and back on.
  await drag({ x: 12.5, z: 4.5 }, { x: 6.5, z: 6.5 });
  await expect.poll(() => position()?.x, { timeout: 10_000 }).toBeCloseTo(6.5);
  expect(position()?.y).toBe(2);
  await rendered(6.5, 6.5);
  await drag({ x: 6.5, z: 6.5 }, { x: 12.5, z: 4.5 });
  await expect.poll(() => position()?.x, { timeout: 10_000 }).toBeCloseTo(12.5);
  expect(position()?.y).toBe(2);
  await rendered(12.5, 4.5);

  // 5. A spectator sees the flag but cannot change it.
  const spectator = await RawClient.connect(table, {
    name: 'spectator',
    identityId: testUlid('SPEC', 61),
    identitySecret: 'spectator-secret',
  });
  await spectator.waitFor('spectator snapshot', () => spectator.state !== undefined);
  const seen = (spectator.state as Snapshot).scenes[sceneId]?.entities[tokenId];
  expect(seen?.token?.flying).toBe(true);
  const denied = await spectator.intent(
    'token.setFlying',
    { sceneId, entityId: tokenId, flying: false },
    sceneId,
  );
  expect(denied.t).toBe('reject');
  expect(entity()?.token?.flying).toBe(true);

  // 6. The panel checkbox releases the lock again.
  // The host controls the value: wait for its patch after sending the click intent.
  await panel.getByRole('checkbox', { name: 'Flying' }).click();
  await expect.poll(() => entity()?.token?.flying, { timeout: 10_000 }).toBeUndefined();
  await expect(panel.getByRole('checkbox', { name: 'Flying' })).not.toBeChecked();
  // Unflown, it stands on the platform, which now reads 0: no badge at all (MV-243).
  await expect(page.getByTestId('elevation-badge')).toHaveCount(0);

  expect(errors).toEqual([]);
  await spectator.close();
  await host.close();
  await context.close();
});
