import { expect, test, type Page } from '@playwright/test';
import { RawClient, startTable, testUlid, type Reply } from './harness.js';

// MV-290 (owner decision MV-289 1A): Create Prop and Edit (token) are separate permissions. A
// player seat with Edit edits the tokens assigned to it and no other seat's, and never creates,
// edits or deletes a prop: the host rejects it, and the client shows those controls disabled with
// a reason (UI-TOOL-07).

interface Snapshot {
  scenes: Record<
    string,
    { entities: Record<string, { name: string; shape?: { walkable: boolean } }> }
  >;
}

const SCENE = testUlid('SCENE', 290);
const MINE = testUlid('SEAT', 290);
const OTHER = testUlid('SEAT', 291);
const MY_TOKEN = testUlid('TOKEN', 290);
const THEIR_TOKEN = testUlid('TOKEN', 291);
const PROP = testUlid('PROP', 290);
const NEW_PROP = testUlid('PROP', 291);
const PLAYER = { identityId: testUlid('PLAYER', 290), identitySecret: 'player-secret' };

const transform = (x: number, z: number) => ({
  position: { x, y: 0, z },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: 1, y: 1, z: 1 },
});
const token = { sizeCells: 1, heightCells: 1, labelVisibility: 'all' };
const shape = { kind: 'box', color: '#888888', walkable: true };

const rail = (page: Page, name: string) =>
  page.getByRole('toolbar', { name: 'Board controls' }).getByRole('button', { name, exact: true });

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

/** UI-TOKEN-02: select the token (retrying until the board is laid out), then use the card's gear. */
async function openTokenMenu(page: Page, x: number, z: number) {
  await expect(async () => {
    // Re-measured each try: a selection can expand the left pane and shift the board.
    const point = (await cellToPixel(page))(x, z);
    await page.mouse.click(point.x, point.y);
    await expect(page.getByTestId('token-preview')).toBeVisible({ timeout: 1000 });
  }).toPass();
  await page.getByTestId('token-preview').getByRole('button', { name: 'Token menu' }).click();
  await expect(page.getByTestId('token-menu')).toBeVisible();
}

async function pageIdentity(page: Page) {
  return page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('mythic.identity.v1') ?? '{}') as {
        identityId: string;
        identitySecret: string;
      },
  );
}

test('a player seat with Edit edits its own token, not another seat’s, and never a prop', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  // Everything sits left of centre: a selection opens the Transform panel over the board's middle.
  const table = await startTable();
  const dmContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const playerContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  try {
    const dm = await dmContext.newPage();
    await dm.goto(`${table.clientUrl.replace(/\/$/, '')}/#host=${table.hostToken}`);
    await expect(dm.getByRole('status')).toHaveText('Connected to New campaign');
    const host = await RawClient.connect(table, { name: 'DM', ...(await pageIdentity(dm)) });
    await host.waitFor('snapshot', () => host.state !== undefined);
    const ok = async (reply: Promise<Reply>) => {
      const r = await reply;
      expect(r, JSON.stringify(r)).toMatchObject({ t: 'ack' });
    };
    const rejected = async (reply: Promise<Reply>) => {
      expect(await reply).toMatchObject({ t: 'reject' });
    };
    const entity = (id: string) => (host.state as Snapshot).scenes[SCENE]?.entities[id];

    await ok(host.intent('scene.create', { sceneId: SCENE, name: 'Props' }));
    await ok(host.intent('scene.activate', { sceneId: SCENE }));
    // Both seats hold every entity permission, so only the token/prop rule can tell them apart.
    for (const [seatId, label] of [
      [MINE, 'Mine'],
      [OTHER, 'Other'],
    ] as const) {
      await ok(host.intent('seat.create', { seatId, label }));
      await ok(
        host.intent('permission.update', {
          target: 'seat',
          seatId,
          permissions: { view: true, move: true, edit: true, delete: true },
        }),
      );
    }
    const create = (id: string, name: string, x: number, extra: Record<string, unknown>) =>
      host.intent('entity.create', {
        sceneId: SCENE,
        entity: { id, layer: 'tokens', name, owners: [], transform: transform(x, 12.5), ...extra },
      });
    await ok(create(MY_TOKEN, 'Mine', 8.5, { owners: [MINE], token }));
    // The other seat's token lets anyone move it (so this player can select it), but grants no edit.
    await ok(
      create(THEIR_TOKEN, 'Theirs', 12.5, { owners: [OTHER], perms: { move: true }, token }),
    );
    // The prop is the player's own and even grants edit and delete: it is still DM-only.
    await ok(
      create(PROP, 'Crate', 16.5, {
        layer: 'props',
        owners: [MINE],
        perms: { edit: true, delete: true },
        shape,
      }),
    );

    // --- the host's rule, from the player's own socket --------------------------------------------
    const raw = await RawClient.connect(table, { name: 'Robin', ...PLAYER });
    await raw.waitFor('snapshot', () => raw.state !== undefined);
    raw.join(MINE);
    await host.waitFor('seated', () => {
      const seats = (host.state as { seats: Record<string, { identityId: string | null }> }).seats;
      return seats[MINE]?.identityId === PLAYER.identityId;
    });
    await rejected(
      raw.intent('entity.create', {
        sceneId: SCENE,
        entity: {
          id: NEW_PROP,
          layer: 'props',
          name: 'Barrel',
          owners: [MINE],
          transform: transform(18.5, 12.5),
          shape,
        },
      }),
    );
    await rejected(
      raw.intent('entity.update', {
        sceneId: SCENE,
        entityId: PROP,
        changes: { name: 'Mine now' },
      }),
    );
    await rejected(
      raw.intent('entity.update', {
        sceneId: SCENE,
        entityId: PROP,
        changes: { shape: { ...shape, walkable: false } },
      }),
    );
    await rejected(raw.intent('entity.delete', { sceneId: SCENE, entityId: PROP }));
    await rejected(
      raw.intent('entity.update', {
        sceneId: SCENE,
        entityId: THEIR_TOKEN,
        changes: { name: 'Stolen' },
      }),
    );
    await rejected(raw.intent('entity.delete', { sceneId: SCENE, entityId: THEIR_TOKEN }));
    await ok(
      raw.intent('entity.update', { sceneId: SCENE, entityId: MY_TOKEN, changes: { name: 'Me' } }),
    );
    await raw.close();
    expect(entity(NEW_PROP)).toBeUndefined();
    expect(entity(PROP)).toMatchObject({ name: 'Crate', shape: { walkable: true } });
    expect(entity(THEIR_TOKEN)?.name).toBe('Theirs');
    await expect.poll(() => entity(MY_TOKEN)?.name).toBe('Me');

    // --- the player's client agrees: disabled, with a reason ---------------------------------------
    await playerContext.addInitScript(
      ({ identity, seatId }) => {
        localStorage.setItem('mythic.identity.v1', JSON.stringify(identity));
        localStorage.setItem(
          'mythic.profile.v1',
          JSON.stringify({ displayName: 'Robin', lastSeatId: seatId }),
        );
      },
      { identity: PLAYER, seatId: MINE },
    );
    const player = await playerContext.newPage();
    const errors: string[] = [];
    player.on('pageerror', (error) => errors.push(error.message));
    await player.goto(table.clientUrl);
    await expect(player.getByRole('status')).toHaveText('Connected to New campaign');
    await expect(player.getByTestId('token-label')).toHaveCount(2);

    // Create Prop stays on the rail, disabled with its reason, though the seat holds Edit.
    await expect(rail(player, 'Create Prop')).toHaveAttribute('aria-disabled', 'true');
    await expect(rail(player, 'Create Prop')).toHaveAttribute(
      'title',
      'Only the DM can create props',
    );
    await rail(player, 'Create Prop').click({ force: true });
    await expect(player.getByRole('form', { name: 'Create prop' })).toHaveCount(0);

    // Their own token: the name is editable, and the rename lands on the host.
    await openTokenMenu(player, 8.5, 12.5);
    const menu = player.getByTestId('token-menu');
    await expect(menu.getByLabel('Name')).toBeEnabled();
    await menu.getByLabel('Name').fill('Robin’s hound');
    await menu.getByRole('button', { name: 'Rename', exact: true }).click();
    await expect.poll(() => entity(MY_TOKEN)?.name).toBe('Robin’s hound');
    await expect(
      player.getByTestId('token-label').filter({ hasText: 'Robin’s hound' }),
    ).toHaveCount(1);

    // A click on empty board drops the selection, and the menu with it.
    const empty = (await cellToPixel(player))(8.5, 20.5);
    await player.mouse.click(empty.x, empty.y);
    await expect(menu).toHaveCount(0);
    await expect(player.getByTestId('token-preview')).toHaveCount(0);

    // Another seat's token: name and delete disabled, with the reason.
    await openTokenMenu(player, 12.5, 12.5);
    await expect(menu.getByTestId('token-menu-name')).toHaveText('Theirs');
    await expect(menu.getByLabel('Name')).toBeDisabled();
    await expect(menu.getByLabel('Name')).toHaveAttribute('title', 'You cannot edit this token.');
    await expect(menu.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled();
    await player.mouse.click(empty.x, empty.y);
    await expect(menu).toHaveCount(0);

    // The prop's own menu: the Collidable toggle is disabled and says why.
    const propMenu = player.getByTestId('prop-context-menu');
    await expect(async () => {
      const propPoint = (await cellToPixel(player))(16.5, 12.5);
      await player.mouse.click(propPoint.x, propPoint.y, { button: 'right' });
      await expect(propMenu).toBeVisible({ timeout: 1000 });
    }).toPass();
    const collidable = propMenu.getByRole('menuitemcheckbox', { name: 'Collidable' });
    await expect(collidable).toBeDisabled();
    await expect(propMenu.locator('label').filter({ hasText: 'Collidable' })).toHaveAttribute(
      'title',
      'Only the DM can edit props.',
    );
    await player.keyboard.press('Escape');
    await expect(propMenu).toHaveCount(0);

    // Nothing the player tried changed the prop or the other seat's token.
    expect(entity(PROP)).toMatchObject({ name: 'Crate', shape: { walkable: true } });
    expect(entity(THEIR_TOKEN)?.name).toBe('Theirs');
    expect(errors).toEqual([]);
    await host.close();
  } finally {
    await dmContext.close();
    await playerContext.close();
    await table.stop();
  }
});
