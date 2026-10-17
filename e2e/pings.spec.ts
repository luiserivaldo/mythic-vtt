import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { openClient, RawClient, startTable, testUlid, type Reply } from './harness.js';

// LAY-05 / UX-40: an Alt-click, or Ping in the right-click menu of an empty board spot or a token,
// drops a short animated marker for everyone at the table. There is no Ping rail button. A ping is an ephemeral message — it never enters campaign state or the action log —
// and the host re-checks the seat's `pins` tool and its rate limits. Marker names are read from
// the development-only render hook, the same one the other render specs use.

interface Diagnostics {
  __mythicRender?: { getObjectNames(): string[] };
}

/** Only the scene sub-tree of the DM's state mirror: presence changes as clients come and go. */
interface HostMirror {
  scenes?: Record<string, unknown>;
}

const ok = async (promise: Promise<Reply>) => {
  expect(await promise).toMatchObject({ t: 'ack' });
};

const HOST = { identityId: testUlid('HOST', 1), identitySecret: 'ping-host' };
const PLAYER = { identityId: testUlid('PLAYER', 1), identitySecret: 'ping-player' };

/** The ping markers currently in a page's scene graph (a marker group is named `ping-<key>`). */
function pingCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const hook = (globalThis as unknown as Diagnostics).__mythicRender;
    return (hook?.getObjectNames() ?? []).filter((name) => name.startsWith('ping-')).length;
  });
}

/** Ping ephemeral frames a page received from one sender, at the transport level. */
const framesFrom = (frames: string[], from: string) =>
  frames.filter((raw) => raw.includes('"channel":"ping"') && raw.includes(from)).length;

/**
 * r3f gives the canvas its real frame only after its first measure. Until then it is the browser's
 * 300x150 default with no pointer handlers mounted, so a click aimed at it would miss and every
 * later sample would read empty. Wait for the board to fill before aiming at it.
 */
async function boardReady(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const box = await page.locator('canvas').boundingBox();
      return box === null ? 0 : Math.min(box.width, box.height);
    })
    .toBeGreaterThan(200);
}

/** A scene cell in page pixels on the default board (the board centres on cell 20, 15). */
async function cellToPixel(page: Page, x: number, z: number) {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas box');
  const zoom = Math.min(box.width / 42, box.height / 32);
  return {
    x: box.x + box.width / 2 + (x - 20) * zoom,
    y: box.y + box.height / 2 + (z - 15) * zoom,
  };
}

/** The board's centre in page pixels: a ping lands wherever the ray reaches the ground plane. */
async function boardCentre(page: Page) {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('an Alt-click and the right-click menus mark the board for everyone, then expire', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const table = await startTable();
  const sceneId = testUlid('SCENE', 1);
  const setup = await RawClient.connect(table, { name: 'DM', ...HOST, hostToken: table.hostToken });
  let dmContext: BrowserContext | undefined;
  let spectatorContext: BrowserContext | undefined;
  try {
    await setup.waitFor('snapshot', () => setup.state !== undefined);
    await ok(setup.intent('scene.create', { sceneId, name: 'Ping scene' }));
    await ok(setup.intent('scene.activate', { sceneId }));
    await ok(
      setup.intent('entity.create', {
        sceneId,
        entity: {
          id: testUlid('TOKEN', 1),
          layer: 'tokens',
          name: 'Pinged token',
          owners: [],
          transform: {
            position: { x: 12.5, y: 0, z: 12.5 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
          },
          token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
        },
      }),
    );

    dmContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await dmContext.addInitScript((identity) => {
      localStorage.setItem('mythic.identity.v1', JSON.stringify(identity));
      localStorage.setItem('mythic.host', '1');
    }, HOST);
    const dm = await dmContext.newPage();
    const errors: string[] = [];
    dm.on('pageerror', (error) => errors.push(error.message));
    await dm.goto(table.clientUrl);
    await expect(dm.locator('canvas')).toBeVisible();
    await boardReady(dm);

    // A seat-less spectator may not ping (PERM-05) but still sees every marker.
    const spectator = await openClient(browser, table, 'viewer');
    spectatorContext = spectator.context;
    await expect(spectator.page.locator('canvas')).toBeVisible();
    await expect(spectator.page.getByLabel('Current scene')).toHaveText('Ping scene');
    await boardReady(spectator.page);

    // UX-40: Ping left the rail for the right-click menus.
    await expect(dm.getByRole('button', { name: 'Ping', exact: true })).toHaveCount(0);
    await expect(spectator.page.getByRole('button', { name: 'Ping', exact: true })).toHaveCount(0);

    const sceneBefore = JSON.stringify((setup.state as HostMirror).scenes?.[sceneId]);

    // Alt+left-click on the board: a marker for the sender and, through the host relay, for everyone
    // else. Both exist at the same time, so one sample can see the pair. The gesture is retried
    // because the board's pointer handlers mount a frame after the canvas has been laid out.
    const centre = await boardCentre(dm);
    await expect(async () => {
      await dm.keyboard.down('Alt');
      await dm.mouse.click(centre.x, centre.y);
      await dm.keyboard.up('Alt');
      expect(await pingCount(dm)).toBeGreaterThan(0);
      expect(await pingCount(spectator.page)).toBeGreaterThan(0);
    }).toPass({ timeout: 15_000 });

    // Short-lived and free of state: the marker clears itself and the scene never changed.
    await expect.poll(async () => pingCount(dm)).toBe(0);
    await expect.poll(async () => pingCount(spectator.page)).toBe(0);
    expect(JSON.stringify((setup.state as HostMirror).scenes?.[sceneId])).toBe(sceneBefore);

    // A seatless spectator cannot ping even by pressing the gesture on its own board.
    const spectatorCentre = await boardCentre(spectator.page);
    await spectator.page.keyboard.down('Alt');
    await spectator.page.mouse.click(spectatorCentre.x, spectatorCentre.y);
    await spectator.page.keyboard.up('Alt');
    await expect.poll(async () => pingCount(spectator.page)).toBe(0);
    await expect.poll(async () => pingCount(dm)).toBe(0);

    // The gesture needs Alt: a plain board click never pings.
    await dm.mouse.click(centre.x, centre.y);
    await dm.waitForTimeout(700);
    expect(await pingCount(dm)).toBe(0);

    await expect.poll(async () => pingCount(dm)).toBe(0);

    // Right-click on empty board: the menu offers Ping, which marks the spot for everyone.
    const board = dm.getByTestId('board-context-menu');
    await expect(async () => {
      await dm.mouse.click(centre.x, centre.y, { button: 'right' });
      await expect(board).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    await board.getByRole('menuitem', { name: 'Ping', exact: true }).click();
    await expect(board).toHaveCount(0);
    await expect.poll(async () => pingCount(dm)).toBeGreaterThan(0);
    await expect.poll(async () => pingCount(spectator.page)).toBeGreaterThan(0);
    await expect.poll(async () => pingCount(dm)).toBe(0);
    await expect.poll(async () => pingCount(spectator.page)).toBe(0);

    // Right-click on a token: its menu carries Ping too, and the marker lands under the token.
    const tokenAt = await cellToPixel(dm, 12.5, 12.5);
    const tokenMenu = dm.getByTestId('token-context-menu');
    await expect(async () => {
      await dm.mouse.click(tokenAt.x, tokenAt.y, { button: 'right' });
      await expect(tokenMenu).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    // A token click opens the token's menu, not the board's.
    await expect(board).toHaveCount(0);
    await tokenMenu.getByRole('menuitem', { name: 'Ping', exact: true }).click();
    await expect.poll(async () => pingCount(dm)).toBeGreaterThan(0);
    await expect.poll(async () => pingCount(spectator.page)).toBeGreaterThan(0);
    await expect.poll(async () => pingCount(dm)).toBe(0);

    // A spectator may not ping (PERM-05): the board menu shows Ping disabled, with the reason.
    const spectatorBoard = spectator.page.getByTestId('board-context-menu');
    await spectator.page.mouse.click(spectatorCentre.x, spectatorCentre.y, { button: 'right' });
    const spectatorPing = spectatorBoard.getByRole('menuitem', { name: 'Ping', exact: true });
    await expect(spectatorPing).toHaveAttribute('aria-disabled', 'true');
    await spectatorPing.click({ force: true });
    await spectator.page.waitForTimeout(500);
    expect(await pingCount(spectator.page)).toBe(0);
    expect(await pingCount(dm)).toBe(0);

    expect(errors).toEqual([]);
  } finally {
    await spectatorContext?.close();
    await dmContext?.close();
    await setup.close();
    await table.stop();
  }
});

test('the host gates a player ping on the seat pins tool and rate-limits a flood', async () => {
  test.setTimeout(60_000);
  const table = await startTable();
  const sceneId = testUlid('SCENE', 2);
  const seatId = testUlid('SEAT', 2);
  const hostId = testUlid('HOST', 2);
  const clients: RawClient[] = [];
  try {
    const host = await RawClient.connect(table, {
      name: 'gate-host',
      identityId: hostId,
      identitySecret: 'gate-host',
      hostToken: table.hostToken,
    });
    clients.push(host);
    await host.waitFor('snapshot', () => host.state !== undefined);
    await ok(host.intent('scene.create', { sceneId, name: 'Gate scene' }));
    await ok(host.intent('scene.activate', { sceneId }));
    await ok(host.intent('seat.create', { seatId, label: 'Pinger' }));

    const player = await RawClient.connect(table, { name: 'pinger', ...PLAYER });
    clients.push(player);
    await player.waitFor('snapshot', () => player.state !== undefined);
    player.join(seatId);
    await player.waitFor('seat joined', () =>
      JSON.stringify(player.state).includes(PLAYER.identityId),
    );

    const ping = { sceneId, x: 5, y: 0, z: 5 };
    // A seat created without tools gets the frozen fallback (ping off), so a player's ping is denied.
    // The host relays its own.
    player.ephemeral('ping', ping);
    host.ephemeral('ping', ping);
    await host.waitFor('host ping relayed', () => framesFrom(host.frames, hostId) === 1);
    expect(framesFrom(host.frames, PLAYER.identityId)).toBe(0);

    await ok(host.intent('seat.update', { seatId, tools: { pins: true } }));
    await player.waitForSeq(host.lastSeq);
    player.ephemeral('ping', ping);
    await host.waitFor(
      'player ping relayed',
      () => framesFrom(host.frames, PLAYER.identityId) === 1,
    );

    // The relay stamps the sender's own identity, so a ping is attributable on every board.
    const relayed = host.frames.filter((raw) => raw.includes('"channel":"ping"')).at(-1) ?? '';
    expect(relayed).toContain(`"from":"${PLAYER.identityId}"`);
    expect(relayed).toContain('"sceneId":"' + sceneId + '"');

    // The per-connection bucket is shared with every other ephemeral, so a flood is capped.
    const before = host.frames.length;
    const flood = 80;
    for (let index = 0; index < flood; index += 1) player.ephemeral('ping', ping);
    await host.waitFor('some pings relayed', () => host.frames.length > before);
    await host.waitFor('the flood settled', () => host.frames.length - before > 5, 3_000);
    expect(host.frames.length - before).toBeLessThan(flood);
  } finally {
    await Promise.all(clients.map((client) => client.close()));
    await table.stop();
  }
});

test('a ping on a DM-only scene reaches the DM only, never a player or a spectator', async () => {
  test.setTimeout(60_000);
  const table = await startTable();
  const publicScene = testUlid('SCENE', 3);
  const prepScene = testUlid('SCENE', 4);
  const seatId = testUlid('SEAT', 3);
  const coDmSeatId = testUlid('SEAT', 4);
  const hostId = testUlid('HOST', 3);
  const viewerId = testUlid('VIEWER', 3);
  const codmId = testUlid('CODM', 3);
  const clients: RawClient[] = [];
  try {
    const host = await RawClient.connect(table, {
      name: 'leak-host',
      identityId: hostId,
      identitySecret: 'leak-host',
      hostToken: table.hostToken,
    });
    clients.push(host);
    await host.waitFor('snapshot', () => host.state !== undefined);
    await ok(host.intent('scene.create', { sceneId: publicScene, name: 'Public' }));
    await ok(host.intent('scene.create', { sceneId: prepScene, name: 'Prep', dmOnly: true }));
    await ok(host.intent('scene.activate', { sceneId: publicScene }));
    await ok(host.intent('seat.create', { seatId, label: 'Pinger' }));
    await ok(host.intent('seat.create', { seatId: coDmSeatId, label: 'Co-DM', role: 'codm' }));

    const player = await RawClient.connect(table, { name: 'leak-player', ...PLAYER });
    clients.push(player);
    await player.waitFor('snapshot', () => player.state !== undefined);
    player.join(seatId);
    await player.waitFor('seat joined', () =>
      JSON.stringify(player.state).includes(PLAYER.identityId),
    );

    // No seat joined: an unseated connection is the shared spectator audience.
    const spectator = await RawClient.connect(table, {
      name: 'leak-viewer',
      identityId: viewerId,
      identitySecret: 'leak-viewer',
    });
    clients.push(spectator);
    await spectator.waitFor('snapshot', () => spectator.state !== undefined);

    // A co-DM is a seat audience, not a spectator: the DM-only scene does exist for it (L4/D32).
    const coDm = await RawClient.connect(table, {
      name: 'leak-codm',
      identityId: codmId,
      identitySecret: 'leak-codm',
    });
    clients.push(coDm);
    await coDm.waitFor('snapshot', () => coDm.state !== undefined);
    // MV-269: only the host grants a co-DM seat.
    await ok(host.intent('seat.assign', { seatId: coDmSeatId, identityId: codmId }));
    await coDm.waitFor('co-DM joined', () => JSON.stringify(coDm.state).includes(codmId));

    // PERM-03: the DM-only prep scene does not exist for a player or a spectator.
    expect(JSON.stringify(player.state)).not.toContain(prepScene);
    expect(JSON.stringify(spectator.state)).not.toContain(prepScene);
    expect(JSON.stringify(coDm.state)).toContain(prepScene);

    // The DM browses the prep scene (UX-04) and pings it; the relay gives the marker back to the DM
    // and to the co-DM, who may see that scene, while the player and the spectator get nothing at all.
    host.ephemeral('ping', { sceneId: prepScene, x: 1, y: 0, z: 1 });
    await host.waitFor(
      'the prep ping relayed to the DM',
      () => framesFrom(host.frames, hostId) === 1,
    );
    await coDm.waitFor(
      'the prep ping relayed to the co-DM',
      () => framesFrom(coDm.frames, hostId) === 1,
    );

    // A control ping on the public scene proves the pipe works. Frames arrive in order on one
    // WebSocket, so once the public ping is seen the prep ping cannot still be in flight: the
    // player and spectator have exactly one ping from the DM, and it is the public one.
    host.ephemeral('ping', { sceneId: publicScene, x: 2, y: 0, z: 2 });
    await player.waitFor(
      'the public ping reached the player',
      () => framesFrom(player.frames, hostId) === 1,
    );
    await spectator.waitFor(
      'the public ping reached the spectator',
      () => framesFrom(spectator.frames, hostId) === 1,
    );
    expect(framesFrom(player.frames, hostId)).toBe(1);
    expect(framesFrom(spectator.frames, hostId)).toBe(1);
    expect(player.frames.join('\n')).not.toContain(prepScene);
    expect(spectator.frames.join('\n')).not.toContain(prepScene);
    // The co-DM saw both pings, the prep one included; the player and spectator only ever saw the
    // public one, so the hidden scene's id and coordinates never reached either of them.
    await coDm.waitFor(
      'the public ping also reached the co-DM',
      () => framesFrom(coDm.frames, hostId) === 2,
    );
    expect(coDm.frames.join('\n')).toContain(prepScene);
  } finally {
    await Promise.all(clients.map((client) => client.close()));
    await table.stop();
  }
});
