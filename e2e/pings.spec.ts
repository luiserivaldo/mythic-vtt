import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { openClient, RawClient, startTable, testUlid, type Reply } from './harness.js';

// LAY-05: an Alt-click, or the board's Ping button, drops a short animated marker for everyone at
// the table. A ping is an ephemeral message — it never enters campaign state or the action log —
// and the host re-checks the scene's `pins` toggle and its rate limits. Marker names are read from
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

/** The board's centre in page pixels: a ping lands wherever the ray reaches the ground plane. */
async function boardCentre(page: Page) {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('an Alt-click and the Ping button mark the board for everyone, then expire', async ({
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

    const pingButton = dm.getByRole('button', { name: 'Ping', exact: true });
    // The DM's board is loaded once the control is offered (the host is exempt from the toggle).
    await expect(pingButton).not.toHaveAttribute('aria-disabled', 'true');
    const spectatorButton = spectator.page.getByRole('button', { name: 'Ping', exact: true });
    await expect(spectatorButton).toHaveAttribute('aria-disabled', 'true');

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

    // The board's Ping button is the same ping, taken from the centre of the view.
    await pingButton.click();
    await expect.poll(async () => pingCount(dm)).toBeGreaterThan(0);
    await expect.poll(async () => pingCount(spectator.page)).toBeGreaterThan(0);

    expect(errors).toEqual([]);
  } finally {
    await spectatorContext?.close();
    await dmContext?.close();
    await setup.close();
    await table.stop();
  }
});

test('the host gates a player ping on the scene pins toggle and rate-limits a flood', async () => {
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
    // `pins` is opt-in: a scene with no toggles denies a player's ping. The host relays its own.
    player.ephemeral('ping', ping);
    host.ephemeral('ping', ping);
    await host.waitFor('host ping relayed', () => framesFrom(host.frames, hostId) === 1);
    expect(framesFrom(host.frames, PLAYER.identityId)).toBe(0);

    await ok(host.intent('scene.setPlayerToggles', { sceneId, toggles: { pins: true } }));
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
