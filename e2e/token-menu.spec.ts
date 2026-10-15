import { expect, test, type Page } from '@playwright/test';
import {
  openClient,
  RawClient,
  recordPageFrames,
  setActiveLayer,
  startTable,
  testUlid,
} from './harness.js';

// UX-20 (UI-TOKEN-02, UI-TOKEN-03): the full token menu opens from the gear or a double-click, near
// the token, with the fields a viewer may not edit disabled; the right-click menu sits to the right
// of the token and offers only what that viewer may do. A name a viewer may not read never reaches
// their menu, page or wire (D35, PERM-03).

interface Snapshot {
  scenes: Record<
    string,
    {
      entities: Record<
        string,
        {
          name: string;
          layer: string;
          transform: { position: { x: number; y: number; z: number } };
          token?: { flying?: boolean; statusMarkers?: unknown[] };
        }
      >;
    }
  >;
}

const SEAT = testUlid('SEAT', 20);
const SCENE = testUlid('SCENE', 20);
const ARIA = testUlid('TOKEN', 20);
const OGRE = testUlid('TOKEN', 21);
const PLAIN = testUlid('TOKEN', 22);
const SECRET = testUlid('TOKEN', 23);
const PLAYER = { identityId: testUlid('PLAYER', 20), identitySecret: 'player-secret' };
const SECRET_NAME = 'Secret drake';

/** Default 40x30 scene: the board centres on cell (20, 15) at one cell per scene unit. */
async function cellToPixel(page: Page) {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas box');
  const zoom = Math.min(box.width / 42, box.height / 32);
  return (x: number, z: number) => ({
    x: box.x + box.width / 2 + (x - 20) * zoom,
    y: box.y + box.height / 2 + (z - 15) * zoom,
  });
}

/** Clicks a cell until the card appears; the first click can land before the board is laid out. */
async function selectCell(page: Page, x: number, z: number) {
  const at = await cellToPixel(page);
  const point = at(x, z);
  await expect(async () => {
    await page.mouse.click(point.x, point.y);
    await expect(page.getByTestId('token-preview')).toBeVisible({ timeout: 1000 });
  }).toPass();
}

/** UI-TOKEN-02: a double-click opens the full menu (and still focuses the camera, CAM-06). */
async function doubleClickCell(page: Page, x: number, z: number) {
  const at = await cellToPixel(page);
  const point = at(x, z);
  await expect(async () => {
    await page.mouse.dblclick(point.x, point.y);
    await expect(page.getByTestId('token-menu')).toBeVisible({ timeout: 1000 });
  }).toPass();
}

/** UI-TOKEN-02: the gear on the preview card opens the same full menu (no camera move). */
async function openMenuViaGear(page: Page, x: number, z: number) {
  await selectCell(page, x, z);
  await page.getByTestId('token-preview').getByRole('button', { name: 'Token menu' }).click();
  await expect(page.getByTestId('token-menu')).toBeVisible();
}

/** UI-TOKEN-03: a right click on a token opens the short menu to its right. */
async function rightClickCell(page: Page, x: number, z: number) {
  const at = await cellToPixel(page);
  const point = at(x, z);
  await expect(async () => {
    await page.mouse.click(point.x, point.y, { button: 'right' });
    await expect(page.getByTestId('token-context-menu')).toBeVisible({ timeout: 1000 });
  }).toPass();
}

const transform = (x: number, z: number, y = 0) => ({
  position: { x, y, z },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: 1, y: 1, z: 1 },
});

/** SES-02: the page claims the host with the DM link; its identity is what the host recognises. */
async function pageIdentity(page: Page) {
  return page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('mythic.identity.v1') ?? '{}') as {
        identityId: string;
        identitySecret: string;
      },
  );
}

const tokenIntent = (id: string, name: string, x: number, extra: Record<string, unknown> = {}) => ({
  sceneId: SCENE,
  entity: {
    id,
    layer: 'tokens',
    name,
    owners: [],
    transform: transform(x, 12.5),
    token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
    ...extra,
  },
});

test('the full menu near the token, and the curated right-click menu', async ({ browser }) => {
  test.setTimeout(180_000);
  const table = await startTable();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${table.clientUrl.replace(/\/$/, '')}/#host=${table.hostToken}`);
    await expect(page.getByRole('status')).toHaveText('Connected to New campaign');

    const host = await RawClient.connect(table, { name: 'DM', ...(await pageIdentity(page)) });
    await host.waitFor('snapshot', () => host.state !== undefined);
    const ok = (reply: Promise<unknown>) => expect(reply).resolves.toMatchObject({ t: 'ack' });
    const state = () => host.state as Snapshot;
    const entity = (id: string) => state().scenes[SCENE]?.entities[id];
    await ok(host.intent('scene.create', { sceneId: SCENE, name: 'Menus' }));
    await ok(host.intent('scene.activate', { sceneId: SCENE }));
    await ok(host.intent('seat.create', { seatId: SEAT, label: 'Owner' }));
    await ok(host.intent('entity.create', tokenIntent(ARIA, 'Aria', 15.5, { owners: [SEAT] })));
    await ok(host.intent('entity.create', tokenIntent(OGRE, 'Ogre', 21.5)));
    await expect(page.getByTestId('token-label')).toHaveCount(2);

    // --- the gear opens the full menu, near the token -------------------------------------------
    await selectCell(page, 15.5, 12.5);
    const card = page.getByTestId('token-preview');
    await card.getByRole('button', { name: 'Token menu' }).click();
    const menu = page.getByTestId('token-menu');
    await expect(menu).toBeVisible();
    await expect(card).toBeVisible();
    await expect(menu.getByTestId('token-menu-name')).toHaveText('Aria');

    const at = await cellToPixel(page);
    const token = at(15.5, 12.5);
    const menuBox = await menu.boundingBox();
    if (!menuBox) throw new Error('no menu box');
    // Near the token: above it, and roughly centred on it.
    expect(menuBox.y + menuBox.height).toBeLessThan(token.y);
    expect(Math.abs(menuBox.x + menuBox.width / 2 - token.x)).toBeLessThan(menuBox.width);

    // --- rename ---------------------------------------------------------------------------------
    const nameInput = menu.getByLabel('Name');
    await expect(nameInput).toBeEnabled();
    await nameInput.fill('Aria the Bold');
    await menu.getByRole('button', { name: 'Rename', exact: true }).click();
    await expect.poll(() => entity(ARIA)?.name).toBe('Aria the Bold');
    await expect(page.getByTestId('token-label').filter({ hasText: 'Aria the Bold' })).toHaveCount(
      1,
    );

    // --- height, with the flying lock (TOK-03) --------------------------------------------------
    const height = menu.getByLabel('Height (ft)');
    await expect(height).toHaveValue('0');
    await menu.getByRole('button', { name: 'Raise height' }).click();
    await expect.poll(() => entity(ARIA)?.transform.position.y).toBe(1);
    await expect(height).toHaveValue('5');
    // The checkbox mirrors the host's patch, so the state flips when the patch lands (not on the
    // click); the action is what the control owes the host.
    await menu.getByRole('checkbox', { name: 'Flying (locks height)' }).click();
    await expect.poll(() => entity(ARIA)?.token?.flying).toBe(true);
    // A typed height in scene units, snapped to the grid (D25).
    await height.fill('15');
    await height.press('Enter');
    await expect.poll(() => entity(ARIA)?.transform.position.y).toBe(3);

    // --- layer (LAY-07) -------------------------------------------------------------------------
    await menu.getByLabel('Layer').selectOption('props');
    await expect.poll(() => entity(ARIA)?.layer).toBe('props');

    // --- delete, confirmed ----------------------------------------------------------------------
    await menu.getByRole('button', { name: 'Delete', exact: true }).click();
    await menu.getByRole('button', { name: /^Confirm delete/ }).click();
    await expect.poll(() => entity(ARIA)).toBeUndefined();
    await expect(menu).toHaveCount(0);

    // --- the right-click menu, to the right of the token -----------------------------------------
    await rightClickCell(page, 21.5, 12.5);
    const actions = page.getByTestId('token-context-menu');
    await expect(actions).toBeVisible();
    const actionsBox = await actions.boundingBox();
    if (!actionsBox) throw new Error('no context menu box');
    expect(actionsBox.x).toBeGreaterThan(at(21.5, 12.5).x);

    // Add Condition opens the icon picker (TOK-06): the pick reaches the host and the marker
    // appears on the token's strip, then that icon is greyed as already held.
    const condition = actions.getByRole('menuitem', { name: 'Add Condition', exact: true });
    await expect(condition).toBeEnabled();
    await expect(actions.getByRole('menuitem', { name: 'See Sheet', exact: true })).toBeEnabled();
    await condition.click();
    const conditions = actions.getByRole('menu', { name: 'Add Condition' });
    await expect(conditions).toBeVisible();
    await conditions.getByRole('menuitem', { name: /Stunned$/ }).click();
    await expect(actions).toHaveCount(0);
    await expect
      .poll(() => entity(OGRE)?.token?.statusMarkers)
      .toEqual([{ kind: 'icon', icon: 'stunned' }]);
    await expect(page.getByTestId('status-marker')).toHaveText(['✦']);
    await rightClickCell(page, 21.5, 12.5);
    await actions.getByRole('menuitem', { name: 'Add Condition', exact: true }).click();
    await expect(conditions.getByRole('menuitem', { name: /Stunned$/ })).toBeDisabled();
    await expect(conditions.getByRole('menuitem', { name: /Prone$/ })).toBeEnabled();

    // Change Layer opens a submenu and moves the token (LAY-07).
    await actions.getByRole('menuitem', { name: 'Change Layer', exact: true }).click();
    const submenu = actions.getByRole('menu', { name: 'Change Layer' });
    await expect(submenu).toBeVisible();
    // The DM may reach every layer but the one the token is already on.
    await expect(submenu.getByRole('menuitem', { name: 'Tokens', exact: true })).toHaveCount(0);
    await submenu.getByRole('menuitem', { name: 'Effects', exact: true }).click();
    await expect.poll(() => entity(OGRE)?.layer).toBe('effects');
    // MV-244: the moved token is only picked again once Effects is the active layer.
    await setActiveLayer(page, 'Effects');

    // Token Options hands over to the full menu; only one menu shows at a time.
    await rightClickCell(page, 21.5, 12.5);
    await actions.getByRole('menuitem', { name: 'Token Options', exact: true }).click();
    await expect(actions).toHaveCount(0);
    await expect(page.getByTestId('token-menu')).toBeVisible();

    // See Sheet jumps the dock to the Sheet tab (UI-SHEET-01).
    await rightClickCell(page, 21.5, 12.5);
    await actions.getByRole('menuitem', { name: 'See Sheet', exact: true }).click();
    await expect(actions).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Sheet', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // --- a double-click opens the same menu (last: its focus tween moves the board under it) -----
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('token-menu')).toHaveCount(0);
    await doubleClickCell(page, 21.5, 12.5);
    await expect(page.getByTestId('token-menu-name')).toHaveText('Ogre');

    expect(errors).toEqual([]);
    await host.close();
  } finally {
    await context.close();
    await table.stop();
  }
});

test('a player gets only what they may do, and never a name they may not read', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const table = await startTable();
  const playerContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const dmContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  try {
    const dm = await dmContext.newPage();
    await dm.goto(`${table.clientUrl.replace(/\/$/, '')}/#host=${table.hostToken}`);
    await expect(dm.getByRole('status')).toHaveText('Connected to New campaign');

    const host = await RawClient.connect(table, { name: 'DM', ...(await pageIdentity(dm)) });
    await host.waitFor('snapshot', () => host.state !== undefined);
    const ok = (reply: Promise<unknown>) => expect(reply).resolves.toMatchObject({ t: 'ack' });
    const state = () => host.state as Snapshot;
    const entity = (id: string) => state().scenes[SCENE]?.entities[id];
    await ok(host.intent('scene.create', { sceneId: SCENE, name: 'Menus' }));
    await ok(host.intent('scene.activate', { sceneId: SCENE }));
    // The default seat holds view and move, so it may move a token it owns but not edit it.
    await ok(host.intent('seat.create', { seatId: SEAT, label: 'Owner' }));
    await ok(host.intent('entity.create', tokenIntent(PLAIN, 'Plain', 15.5, { owners: [SEAT] })));
    // SECRET grants a move but no edit, and its name is owner-only: this seat may not read it.
    await ok(
      host.intent(
        'entity.create',
        tokenIntent(SECRET, SECRET_NAME, 21.5, {
          perms: { move: true },
          token: { sizeCells: 1, heightCells: 1, labelVisibility: 'owner' },
        }),
      ),
    );
    await ok(host.intent('seat.assign', { seatId: SEAT, identityId: PLAYER.identityId }));

    await playerContext.addInitScript(
      ({ identity, seatId }) => {
        localStorage.setItem('mythic.identity.v1', JSON.stringify(identity));
        localStorage.setItem(
          'mythic.profile.v1',
          JSON.stringify({ displayName: 'Owner', lastSeatId: seatId }),
        );
      },
      { identity: PLAYER, seatId: SEAT },
    );
    const player = await playerContext.newPage();
    const errors: string[] = [];
    player.on('pageerror', (error) => errors.push(error.message));
    const frames = recordPageFrames(player);
    await player.goto(table.clientUrl);
    await expect(player.getByRole('status')).toHaveText('Connected to New campaign');
    // Only PLAIN's label: the secret token's owner-only label renders no name for this seat (D35).
    await expect(player.getByTestId('token-label')).toHaveCount(1);

    // --- the fields this seat may not edit are disabled, with a reason ---------------------------
    await openMenuViaGear(player, 15.5, 12.5);
    const menu = player.getByTestId('token-menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByTestId('token-menu-name')).toHaveText('Plain');
    await expect(menu.getByLabel('Name')).toBeDisabled();
    await expect(menu.getByLabel('Name')).toHaveAttribute('title', 'You cannot edit this token.');
    await expect(menu.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled();
    // The seat may move it, so height and flight stay live.
    await expect(menu.getByLabel('Height (ft)')).toBeEnabled();
    await player.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);

    // --- the right-click menu shows a curated list for this viewer (PERM-02) ---------------------
    await rightClickCell(player, 15.5, 12.5);
    const actions = player.getByTestId('token-context-menu');
    await expect(actions.getByRole('menuitem', { name: 'See Sheet', exact: true })).toBeEnabled();
    await expect(actions.getByRole('menuitem', { name: 'Add Condition' })).toBeDisabled();
    await expect(
      actions.getByRole('menuitem', { name: 'Change Layer', exact: true }),
    ).toBeEnabled();
    await expect(
      actions.getByRole('menuitem', { name: 'Token Options', exact: true }),
    ).toBeEnabled();
    await player.keyboard.press('Escape');
    await expect(actions).toHaveCount(0);

    // --- a token whose name this seat may not read ----------------------------------------------
    await openMenuViaGear(player, 21.5, 12.5);
    await expect(menu).toBeVisible();
    // The stand-in, and the field is not theirs to edit.
    await expect(menu.getByTestId('token-menu-name')).toHaveText('Unknown token');
    await expect(menu.getByTestId('token-menu-name')).not.toHaveText(SECRET_NAME);
    await expect(menu.getByLabel('Name')).toHaveValue('Unknown token');
    await expect(menu.getByLabel('Name')).toBeDisabled();
    await expect(menu.getByLabel('Name')).toHaveAttribute(
      'title',
      'This token’s name is not shared with you.',
    );
    // They may move it, so height and flight are live.
    await expect(menu.getByLabel('Height (ft)')).toBeEnabled();
    await menu.getByRole('button', { name: 'Raise height' }).click();
    await expect.poll(() => entity(SECRET)?.transform.position.y).toBe(1);

    // PERM-03: the hidden name is nowhere in this viewer's page or wire.
    expect((await player.locator('html').textContent()) ?? '').not.toContain(SECRET_NAME);
    await player.waitForTimeout(200);
    expect(frames.join('\n')).not.toContain(SECRET_NAME);

    // --- a spectator may not select, so neither menu opens at all (PERM-01/02) -------------------
    const spectator = await openClient(browser, table, 'viewer');
    await spectator.page.reload();
    await expect(spectator.page.locator('canvas')).toBeVisible();
    const spectatorAt = await cellToPixel(spectator.page);
    const point = spectatorAt(15.5, 12.5);
    await spectator.page.mouse.click(point.x, point.y);
    await spectator.page.mouse.dblclick(point.x, point.y);
    await expect(spectator.page.getByTestId('token-menu')).toHaveCount(0);
    await spectator.page.mouse.click(point.x, point.y, { button: 'right' });
    await expect(spectator.page.getByTestId('token-context-menu')).toHaveCount(0);
    await expect(spectator.page.getByTestId('token-preview')).toHaveCount(0);
    await spectator.context.close();

    expect(errors).toEqual([]);
    await host.close();
  } finally {
    await dmContext.close();
    await playerContext.close();
    await table.stop();
  }
});
