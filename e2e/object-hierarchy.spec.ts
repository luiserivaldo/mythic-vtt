import { expect, test, type Page } from '@playwright/test';
import {
  claimSeat,
  RawClient,
  recordPageFrames,
  setActiveLayer,
  startTable,
  testUlid,
  type Table,
} from './harness.js';

// UI-ENT-01 / C16 (MV-245, MV-264): in 3D the DM gets a Hierarchy dock tab listing every object by
// layer. Rows and board picks share one selection; a row's popup renames the object and sets a
// prop's collidable flag through entity.update. Rows off the active layer are shaded and inert
// (MV-258), as are rows on a locked or hidden layer (MV-276). A Co-DM gets the tab too; a player
// never does.

const SCENE = testUlid('SCENE', 264);
const SEAT = testUlid('SEAT', 264);
const CODM_SEAT = testUlid('SEAT', 265);
const CRATE = testUlid('PROP', 264);
const SLAB = testUlid('PROP', 265);
const GOBLIN = testUlid('TOKEN', 264);
const SECRET = testUlid('TOKEN', 265);
const SECRET_NAME = 'Hierarchy Lurker MV264';

const box = (
  id: string,
  name: string,
  at: { x: number; z: number },
  size: { x: number; y: number; z: number },
) => ({
  id,
  layer: 'props',
  name,
  owners: [],
  transform: {
    position: { x: at.x, y: 0, z: at.z },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: size,
  },
  shape: { kind: 'box', color: '#808080', walkable: true },
});
const token = (id: string, layer: 'tokens' | 'dm', name: string, x: number) => ({
  id,
  layer,
  name,
  owners: [],
  transform: {
    position: { x, y: 0, z: 3 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  },
  token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all', color: '#40c0ff' },
});

interface Snapshot {
  scenes: Record<
    string,
    { entities: Record<string, { name: string; shape?: { walkable: boolean } }> }
  >;
}

const selection = (page: Page): Promise<string[]> =>
  page.evaluate(
    () =>
      (
        globalThis as unknown as { __mythicRender?: { getSelection(): string[] } }
      ).__mythicRender?.getSelection() ?? [],
  );

let table: Table | undefined;
test.beforeAll(async () => {
  table = await startTable();
});
test.afterAll(async () => {
  await table?.stop();
});

test('the DM hierarchy follows and drives the 3D selection, edits a prop, and never reaches a player', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  if (!table) throw new Error('table not started');
  const identity = { identityId: testUlid('HOST', 264), identitySecret: 'hierarchy-host' };
  const host = await RawClient.connect(table, {
    name: 'DM',
    ...identity,
    hostToken: table.hostToken,
  });
  const ok = async (type: string, payload: Record<string, unknown>) => {
    expect(await host.intent(type, payload), type).toMatchObject({ t: 'ack' });
  };
  await ok('scene.create', { sceneId: SCENE, name: 'Vault' });
  await ok('scene.activate', { sceneId: SCENE });
  await ok('seat.create', { seatId: SEAT, label: 'Rogue' });
  // A Co-DM seat is never offered on the join screen: the host assigns it to an identity.
  const coDmIdentity = { identityId: testUlid('CODM', 264), identitySecret: 'hierarchy-codm' };
  await ok('seat.create', { seatId: CODM_SEAT, label: 'Warden', role: 'codm' });
  await ok('seat.assign', { seatId: CODM_SEAT, identityId: coDmIdentity.identityId });
  await ok('entity.create', {
    sceneId: SCENE,
    entity: box(CRATE, 'Crate', { x: 3, z: 26 }, { x: 1, y: 1, z: 1 }),
  });
  // A wide, low slab under the board centre, so a click on the 3D view's centre lands on it.
  await ok('entity.create', {
    sceneId: SCENE,
    entity: box(SLAB, 'Slab', { x: 20, z: 15 }, { x: 24, y: 0.5, z: 18 }),
  });
  await ok('entity.create', { sceneId: SCENE, entity: token(GOBLIN, 'tokens', 'Goblin', 3) });
  await ok('entity.create', { sceneId: SCENE, entity: token(SECRET, 'dm', SECRET_NAME, 5) });
  const hostEntity = (id: string) =>
    (host.state as Snapshot | undefined)?.scenes[SCENE]?.entities[id];

  const dmContext = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await dmContext.addInitScript((value) => {
    localStorage.setItem('mythic.identity.v1', JSON.stringify(value));
    localStorage.setItem('mythic.host', '1');
  }, identity);
  const dm = await dmContext.newPage();
  const playerContext = await browser.newContext();
  const player = await playerContext.newPage();
  const playerFrames = recordPageFrames(player);
  const coDmContext = await browser.newContext();
  await coDmContext.addInitScript(
    ({ identity, seatId }) => {
      localStorage.setItem('mythic.identity.v1', JSON.stringify(identity));
      localStorage.setItem(
        'mythic.profile.v1',
        JSON.stringify({ displayName: 'Wren', lastSeatId: seatId }),
      );
    },
    { identity: coDmIdentity, seatId: CODM_SEAT },
  );
  const coDm = await coDmContext.newPage();
  const errors: string[] = [];
  dm.on('pageerror', (error) => errors.push(error.message));
  player.on('pageerror', (error) => errors.push(error.message));
  coDm.on('pageerror', (error) => errors.push(error.message));

  try {
    await dm.goto(table.clientUrl);
    await expect(dm.getByRole('status')).toHaveText('Connected to New campaign');
    const hierarchyTab = dm.getByRole('tab', { name: 'Hierarchy', exact: true });
    // C16: a 3D edit-mode tab; the 2D dock does not offer it.
    await expect(dm.getByRole('tab', { name: 'Entities', exact: true })).toBeVisible();
    await expect(hierarchyTab).toHaveCount(0);

    await setActiveLayer(dm, 'Props');
    await dm.getByRole('button', { name: '3D view' }).click();
    await hierarchyTab.click();
    const panel = dm.getByRole('region', { name: 'Hierarchy' });
    const props = panel.getByRole('list', { name: 'Props layer' });
    await expect(props.getByRole('button', { name: 'Crate', exact: true })).toBeVisible();
    await expect(props.getByRole('button', { name: 'Slab', exact: true })).toBeVisible();
    await expect(panel.getByRole('list', { name: 'DM only layer' })).toContainText(SECRET_NAME);

    // MV-258: the Tokens layer is not active, so its row is shaded and cannot be picked.
    const goblin = panel.getByRole('button', { name: 'Goblin', exact: true });
    await expect(goblin).toBeDisabled();
    await expect(panel.locator(`li[data-entity-id="${GOBLIN}"]`)).toHaveAttribute(
      'data-dimmed',
      'true',
    );

    // Row → viewport: picking Crate in the hierarchy selects it on the board.
    const crateRow = props.getByRole('button', { name: 'Crate', exact: true });
    await crateRow.click();
    await expect.poll(() => selection(dm)).toEqual([CRATE]);
    await expect(crateRow).toHaveAttribute('aria-pressed', 'true');

    // Viewport → row: a click on the board picks Slab, and the highlight moves to its row.
    const slabRow = props.getByRole('button', { name: 'Slab', exact: true });
    const canvas = dm.locator('canvas').first();
    await expect(async () => {
      const area = await canvas.boundingBox();
      if (!area) throw new Error('canvas has no box');
      await dm.mouse.click(area.x + area.width / 2, area.y + area.height / 2);
      expect(await selection(dm)).toEqual([SLAB]);
    }).toPass({ timeout: 15_000 });
    await expect(slabRow).toHaveAttribute('aria-pressed', 'true');
    await expect(crateRow).toHaveAttribute('aria-pressed', 'false');

    // The popup renames the prop and clears its collidable flag; the host state follows.
    await panel.getByRole('button', { name: 'Edit Crate', exact: true }).click();
    await expect.poll(() => selection(dm)).toEqual([CRATE]);
    const popup = panel.getByRole('dialog');
    await expect(popup).toHaveAccessibleName('Edit Crate');
    await popup.getByPlaceholder('Name of Crate').fill('Iron Crate');
    await popup.getByRole('button', { name: 'Rename', exact: true }).click();
    await expect.poll(() => hostEntity(CRATE)?.name).toBe('Iron Crate');
    await expect(popup).toHaveAccessibleName('Edit Iron Crate');
    await expect(props.getByRole('button', { name: 'Iron Crate', exact: true })).toBeVisible();

    const collidable = popup.getByRole('checkbox', { name: 'Collidable' });
    await expect(collidable).toBeChecked();
    // Controlled by the host state: it flips once the host applies the update.
    await collidable.click();
    await expect.poll(() => hostEntity(CRATE)?.shape?.walkable).toBe(false);
    await expect(collidable).not.toBeChecked();
    await popup.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(popup).toHaveCount(0);

    // MV-276: the popup opens with its name field focused, so Escape closes it straight away and
    // focus returns to the row's edit button.
    const editCrate = panel.getByRole('button', { name: 'Edit Iron Crate', exact: true });
    await editCrate.click();
    await expect(popup.getByPlaceholder('Name of Iron Crate')).toBeFocused();
    await dm.keyboard.press('Escape');
    await expect(popup).toHaveCount(0);
    await expect(editCrate).toBeFocused();

    // MV-276: a row on a locked layer is disabled, and clicking it leaves the selection alone.
    const ironCrateRow = props.getByRole('button', { name: 'Iron Crate', exact: true });
    await slabRow.click();
    await expect.poll(() => selection(dm)).toEqual([SLAB]);
    await ok('layer.lock', { sceneId: SCENE, layer: 'props', locked: true });
    await expect(ironCrateRow).toBeDisabled();
    await expect(ironCrateRow).toHaveAttribute('title', 'Props is locked');
    const lockedBefore = await selection(dm);
    await ironCrateRow.click({ force: true });
    await expect(ironCrateRow).toHaveAttribute('aria-pressed', 'false');
    expect(await selection(dm)).toEqual(lockedBefore);
    await ok('layer.lock', { sceneId: SCENE, layer: 'props', locked: false });
    await expect(ironCrateRow).toBeEnabled();

    // The same for a layer hidden on this screen (the eye in the Layers tab).
    await slabRow.click();
    await expect.poll(() => selection(dm)).toEqual([SLAB]);
    await dm.getByRole('tab', { name: 'Layers', exact: true }).click();
    const showProps = dm
      .getByRole('region', { name: 'Layers' })
      .getByRole('checkbox', { name: 'Show Props' });
    await showProps.click();
    await expect(showProps).not.toBeChecked();
    await hierarchyTab.click();
    await expect(ironCrateRow).toBeDisabled();
    await expect(ironCrateRow).toHaveAttribute('title', 'Props is hidden');
    const hiddenBefore = await selection(dm);
    await ironCrateRow.click({ force: true });
    await expect(ironCrateRow).toHaveAttribute('aria-pressed', 'false');
    expect(await selection(dm)).toEqual(hiddenBefore);
    await dm.getByRole('tab', { name: 'Layers', exact: true }).click();
    await showProps.click();
    await expect(showProps).toBeChecked();
    await hierarchyTab.click();
    await expect(ironCrateRow).toBeEnabled();

    // Back in 2D the tab is withdrawn and the dock falls back to Chat.
    await dm.getByRole('button', { name: '2D view' }).click();
    await expect(hierarchyTab).toHaveCount(0);
    await expect(panel).toHaveCount(0);

    // A player in 3D is never offered the hierarchy, nor sent the DM layer (PERM-03).
    await player.goto(table.clientUrl);
    await claimSeat(player, 'Rogue', 'Pia');
    await expect(player.getByRole('status')).toHaveText('Connected to New campaign');
    await player.getByRole('button', { name: '3D view' }).click();
    await expect(player.getByRole('button', { name: '2D view' })).toBeVisible();
    await expect(player.getByRole('tab', { name: 'Chat', exact: true })).toBeVisible();
    await expect(player.getByRole('tab', { name: 'Hierarchy', exact: true })).toHaveCount(0);
    await expect(player.getByRole('region', { name: 'Hierarchy' })).toHaveCount(0);
    const leaks = playerFrames.filter((f) => f.includes(SECRET) || f.includes(SECRET_NAME));
    expect(leaks).toEqual([]);
    expect(playerFrames.length).toBeGreaterThan(0);

    // MV-276: a Co-DM seat is an admin, so it gets the tab in 3D (and not in 2D).
    await coDm.goto(table.clientUrl);
    await expect(coDm.getByRole('status')).toHaveText('Connected to New campaign');
    const coDmTab = coDm.getByRole('tab', { name: 'Hierarchy', exact: true });
    await expect(coDm.getByRole('tab', { name: 'Entities', exact: true })).toBeVisible();
    await expect(coDmTab).toHaveCount(0);
    await coDm.getByRole('button', { name: '3D view' }).click();
    await coDmTab.click();
    await expect(
      coDm.getByRole('region', { name: 'Hierarchy' }).getByRole('list', { name: 'Props layer' }),
    ).toContainText('Iron Crate');
    expect(errors).toEqual([]);
  } finally {
    await host.close();
    await dmContext.close();
    await playerContext.close();
    await coDmContext.close();
  }
});
