import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { RawClient, testUlid } from './harness.js';
import { PNG, start, stop, type Running } from './host-process.js';

// UI-HOST-01 / UI-HOST-02 (HOST-01, HOST-03): "I'm the DM" on the join screen takes the DM link,
// then the host screen lists the campaigns (last played first, with thumbnails) and offers Invite,
// seat management and Start game. D24/D36: only the host-bound identity gets past it; a visitor on
// the join link sees no campaign, no thumbnail and gains no host binding.

const DM = { identityId: testUlid('HOST', 32), identitySecret: 'ux-32-dm-secret' };
const base = (running: Running) => `http://127.0.0.1:${String(running.hostPort)}`;
const auth = (who: { identityId: string; identitySecret: string }) => ({
  authorization: `Mythic ${who.identityId}.${who.identitySecret}`,
});

/** One host run that only makes a campaign; `gamma` also gets a DM-uploaded thumbnail. */
async function playOnce(dataDir: string, name: string, thumbnail: boolean): Promise<void> {
  const running = await start(dataDir, ['--new-campaign', name]);
  try {
    const dm = await RawClient.connect(running, {
      name: 'DM',
      ...DM,
      hostToken: running.hostToken,
    });
    await dm.waitFor('snapshot', () => dm.state !== undefined);
    if (thumbnail) {
      const upload = await fetch(`${base(running)}/assets/images`, {
        method: 'POST',
        headers: { 'content-type': 'image/png', ...auth(DM) },
        body: PNG,
      });
      expect(upload.status).toBe(201);
      const { hash } = ((await upload.json()) as { image: { hash: string } }).image;
      expect(await dm.intent('campaign.setBranding', { screenshot: hash })).toMatchObject({
        t: 'ack',
      });
    }
    await dm.close();
  } finally {
    await stop(running);
  }
}

async function visitor(
  browser: Browser,
  running: Running,
): Promise<{ page: Page; done: () => Promise<void> }> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(base(running));
  await expect(page.getByRole('heading', { name: 'Join the table' })).toBeVisible();
  return { page, done: () => context.close() };
}

const storedIdentity = (page: Page) =>
  page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('mythic.identity.v1') ?? '{}') as {
        identityId: string;
        identitySecret: string;
      },
  );

test('the DM picks a campaign by last played, opens Invite, seats a player and starts', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const dataDir = await mkdtemp(join(tmpdir(), 'mythic-host-screen-'));
  let running: Running | undefined;
  try {
    // Played in this order: Beta, Gamma (with a thumbnail), then Alpha, which is open again now.
    // UX-05b: last played is each run's end-of-session save, not when the host opened it.
    await playOnce(dataDir, 'Beta', false);
    await playOnce(dataDir, 'Gamma', true);
    await playOnce(dataDir, 'Alpha', false);
    running = await start(dataDir, ['--campaign', 'Alpha']);
    const dmLink = `${base(running)}/#host=${running.hostToken}`;

    const dm = await visitor(browser, running);
    const page = dm.page;
    await page.getByRole('button', { name: "I'm the DM" }).click();
    await page.getByLabel('DM link').fill(dmLink);
    await page.getByRole('button', { name: 'Continue' }).click();

    const screen = page.getByRole('dialog', { name: 'Choose a campaign' });
    await expect(screen).toBeVisible();
    // D24: the token is scrubbed from the address bar again.
    expect(page.url()).not.toContain('host=');
    const rows = screen.getByRole('list', { name: 'Campaigns' }).getByRole('listitem');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('Alpha');
    await expect(rows.nth(0)).toContainText('Open on this host');
    await expect(rows.nth(1)).toContainText('Gamma');
    await expect(rows.nth(2)).toContainText('Beta');
    for (const row of [0, 1, 2]) await expect(rows.nth(row)).toContainText('Last played');
    const thumb = screen.getByRole('img', { name: 'Thumbnail of Gamma' });
    await expect(thumb).toHaveAttribute('src', /^blob:/);
    await expect
      .poll(() =>
        thumb.evaluate((img) => (img as unknown as { naturalWidth: number }).naturalWidth),
      )
      .toBeGreaterThan(0);
    await expect(screen.getByRole('img', { name: 'Thumbnail of Beta' })).toHaveCount(0);

    // Another campaign than the open one is explained, not switched (HOST-03: one per process).
    await screen.getByRole('button', { name: 'Choose Beta' }).click();
    await expect(screen.getByRole('alert')).toContainText('restart the host');
    await screen.getByRole('button', { name: 'Choose Alpha' }).click();

    const tableScreen = page.getByRole('dialog', { name: 'Alpha' });
    await expect(tableScreen).toBeVisible();
    await tableScreen.getByRole('button', { name: 'Invite', exact: true }).click();
    const invite = tableScreen.getByRole('region', { name: 'Invite players' });
    await expect(invite).toBeVisible();
    await expect(invite.getByRole('link', { name: /Playing over the internet/ })).toBeVisible();

    // A player is connected but unseated; the DM adds a seat and assigns it from the roster.
    const robin = await RawClient.connect(running, {
      name: 'Robin',
      identityId: testUlid('PLAYER', 32),
      identitySecret: 'ux-32-robin',
    });
    await robin.waitFor('snapshot', () => robin.state !== undefined);
    await tableScreen.getByLabel('Seat name').fill('Ranger');
    await tableScreen.getByRole('button', { name: 'Add seat' }).click();
    const seatRow = tableScreen.getByRole('listitem', { name: 'Ranger seat', exact: true });
    await seatRow.locator('summary').click();
    const picker = seatRow.getByLabel('Connected participant for Ranger');
    await expect(picker.locator('option', { hasText: 'Robin' })).toHaveCount(1);
    await picker.selectOption(testUlid('PLAYER', 32));
    await seatRow.getByRole('button', { name: 'Assign', exact: true }).click();
    await robin.waitFor('seated', () =>
      Object.values(
        (robin.state as { seats: Record<string, { label: string; identityId?: string }> }).seats,
      ).some((s) => s.label === 'Ranger' && s.identityId === testUlid('PLAYER', 32)),
    );
    await expect(seatRow).toContainText('Robin');
    await robin.close();

    await tableScreen.getByRole('button', { name: 'Start game' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('status')).toHaveText('Connected to Alpha');
    await expect(page.getByRole('button', { name: 'Invite', exact: true })).toBeVisible();
    await dm.done();
  } finally {
    if (running) await stop(running);
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('a DM link for another host is held back until the DM continues', async ({ browser }) => {
  test.setTimeout(60_000);
  const dataDir = await mkdtemp(join(tmpdir(), 'mythic-host-screen-origin-'));
  let running: Running | undefined;
  try {
    running = await start(dataDir, ['--new-campaign', 'Far Table']);
    const token = running.hostToken;
    const dm = await visitor(browser, running);
    const page = dm.page;
    const sent: string[] = [];
    page.on('websocket', (ws) => {
      ws.on('framesent', (frame) => {
        if (typeof frame.payload === 'string') sent.push(frame.payload);
      });
    });

    // MV-284: the printed link names localhost while this page is 127.0.0.1 (another origin).
    const foreignLink = `http://localhost:${String(running.hostPort)}/#host=${token}`;
    const tokenSent = () => sent.some((frame) => frame.includes(token));
    await page.getByRole('button', { name: "I'm the DM" }).click();
    const step = page.getByRole('dialog', { name: "I'm the DM" });
    const field = page.getByLabel('DM link');
    const cont = page.getByRole('button', { name: 'Continue', exact: true });
    const anyway = page.getByRole('button', { name: 'Continue anyway' });
    await field.fill(foreignLink);
    await cont.click();
    await expect(step.getByRole('alert')).toHaveText(
      `This link is for localhost:${String(running.hostPort)}, not this page. Open it there, or continue to use it here.`,
    );
    expect(page.url()).not.toContain('host=');
    expect(tokenSent()).toBe(false);

    // Editing the link clears the warning, so the next Continue warns again before sending.
    await field.fill(` ${foreignLink} `);
    await expect(step.getByRole('alert')).toHaveCount(0);
    await expect(cont).toBeVisible();

    // A double click on Continue shows the warning; its second click does not confirm.
    await cont.dblclick();
    await expect(anyway).toBeVisible();
    await page.waitForTimeout(1_000);
    expect(page.url()).not.toContain('host=');
    expect(tokenSent()).toBe(false);

    // Enter twice in the field: the first warns, the second does nothing.
    await field.fill(foreignLink);
    await expect(cont).toBeVisible();
    await field.press('Enter');
    await field.press('Enter');
    await expect(anyway).toBeVisible();
    await expect(field).toBeFocused();
    await page.waitForTimeout(1_000);
    expect(page.url()).not.toContain('host=');
    expect(tokenSent()).toBe(false);

    // Even armed, the confirm ignores the second click of a double click.
    await expect(anyway).toBeEnabled();
    const box = await anyway.boundingBox();
    if (box === null) throw new Error('no Continue anyway button');
    // Only the second press of the pair (detail 2): the first one would be a deliberate click.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down({ clickCount: 2 });
    await page.mouse.up({ clickCount: 2 });
    await page.waitForTimeout(1_000);
    expect(page.url()).not.toContain('host=');
    expect(tokenSent()).toBe(false);

    // A deliberate click on the armed confirm goes on.
    await anyway.click();
    await expect(page.getByRole('dialog', { name: 'Choose a campaign' })).toContainText(
      'Far Table',
    );
    expect(tokenSent()).toBe(true);
    await dm.done();
  } finally {
    if (running) await stop(running);
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('a visitor on the join link cannot reach the DM path', async ({ browser }) => {
  test.setTimeout(90_000);
  const dataDir = await mkdtemp(join(tmpdir(), 'mythic-host-screen-deny-'));
  let running: Running | undefined;
  try {
    // The open campaign's title is public (UI-JOIN-01); the other campaign on the host is not.
    await playOnce(dataDir, 'Secret Saga', true);
    running = await start(dataDir, ['--new-campaign', 'Open Table']);
    const host = running;
    const listed: number[] = [];

    // A pasted link with the wrong token: the host refuses it, nothing is listed.
    const stranger = await visitor(browser, host);
    stranger.page.on('response', (response) => {
      if (new URL(response.url()).pathname.startsWith('/api/campaigns'))
        listed.push(response.status());
    });
    await stranger.page.getByRole('button', { name: "I'm the DM" }).click();
    await stranger.page.getByLabel('DM link').fill('not a link');
    await expect(stranger.page.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await stranger.page.getByLabel('DM link').fill(`${base(host)}/#host=guessed-token-1234`);
    await stranger.page.getByRole('button', { name: 'Continue' }).click();
    const refused = stranger.page.getByRole('dialog', { name: "I'm the DM" });
    const friendly = "This DM link can't be used. Please make a new link.";
    await expect(refused.getByRole('alert')).toHaveText(friendly);
    await expect(stranger.page.getByRole('list', { name: 'Campaigns' })).toHaveCount(0);
    await expect(stranger.page.getByText('Secret Saga')).toHaveCount(0);

    // MV-285: only Reload; the raw reason sits collapsed under "Error details", never the token.
    await expect(refused.getByRole('button', { name: 'Back' })).toHaveCount(0);
    const raw = refused.getByText('Code: unauthorized', { exact: false });
    await expect(raw).toBeHidden();
    await refused.getByText('Error details').click();
    await expect(raw).toBeVisible();
    await expect(refused.locator('details pre')).toContainText('Message: host token rejected');
    await expect(refused.locator('details pre')).toContainText('Fatal: true');
    await expect(refused.locator('details pre')).not.toContainText('guessed-token-1234');

    // MV-285: Reload does not send the refused token again; it lands on the join screen.
    await refused.getByRole('button', { name: 'Reload' }).click();
    await expect(stranger.page.getByRole('heading', { name: 'Join the table' })).toBeVisible();
    await expect(stranger.page.getByRole('button', { name: "I'm the DM" })).toBeVisible();

    // Forging the UI hints (host screen flag, remembered host) without a token gets no further:
    // the socket connects as a visitor and the host refuses the list.
    await stranger.page.evaluate(() => {
      sessionStorage.setItem('mythic.host.screen', '1');
      localStorage.setItem('mythic.host', '1');
    });
    await stranger.page.reload();
    await expect(refused.getByRole('alert')).toHaveText(friendly);
    await expect(stranger.page.getByRole('list', { name: 'Campaigns' })).toHaveCount(0);
    await expect(stranger.page.getByText('Secret Saga')).toHaveCount(0);
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.every((status) => status === 401 || status === 403)).toBe(true);

    await refused.getByText('Error details').click();
    await expect(refused.locator('details pre')).toContainText(/GET \/api\/campaigns: HTTP 40[13]/);
    await expect(refused.getByRole('button', { name: 'Back' })).toHaveCount(0);

    // The visitor's own credential is refused by the list and the thumbnail routes.
    const identity = await storedIdentity(stranger.page);
    for (const path of ['/api/campaigns', '/api/campaigns/x/thumbnail']) {
      const response = await fetch(`${base(host)}${path}`, { headers: auth(identity) });
      expect([401, 403]).toContain(response.status);
      expect(await response.text()).not.toContain('Secret Saga');
    }
    const ids = (await (
      await fetch(`${base(host)}/api/campaigns`, { headers: auth(DM) })
    ).json()) as {
      current: string;
      campaigns: { id: string }[];
    };
    const sagaId = ids.campaigns.find((c) => c.id !== ids.current)?.id ?? '';
    expect(sagaId).not.toBe('');
    const forged = await fetch(`${base(host)}/api/campaigns/${sagaId}/thumbnail`, {
      headers: auth(identity),
    });
    expect(forged.status).toBe(403);
    await stranger.done();

    // The wrong guesses spent nothing: the real DM link still makes its holder the DM.
    const owner = await visitor(browser, host);
    await owner.page.getByRole('button', { name: "I'm the DM" }).click();
    await owner.page.getByLabel('DM link').fill(`${base(host)}/#host=${host.hostToken}`);
    await owner.page.getByRole('button', { name: 'Continue' }).click();
    await expect(owner.page.getByRole('dialog', { name: 'Choose a campaign' })).toContainText(
      'Secret Saga',
    );
    // And the stranger is still not the host.
    const after = await fetch(`${base(host)}/api/campaigns`, { headers: auth(identity) });
    expect(after.status).toBe(403);
    await owner.done();
  } finally {
    if (running) await stop(running);
    await rm(dataDir, { recursive: true, force: true });
  }
});
