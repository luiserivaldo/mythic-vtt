import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { openClient, recordPageFrames, startTable, type Table } from './harness.js';

// M1-11 / SES-01, SES-06: a first-time visitor fills the join screen, picks a free seat and the
// DM sees them by name; the DM seats a spectator from the roster without typing an id.
let table: Table | undefined;

test.beforeAll(async () => {
  table = await startTable();
});
test.afterAll(async () => {
  await table?.stop();
});

async function addSeat(dm: Page, label: string): Promise<void> {
  await dm.getByPlaceholder('Custom participant name').fill(label);
  await dm.getByRole('button', { name: 'Add custom participant' }).click();
  await expect(dm.getByRole('heading', { name: 'Participants and permissions' })).toBeVisible();
  await expect(dm.getByText(label, { exact: true }).first()).toBeVisible();
}

test('a new visitor joins by name and seat; the DM sees them and seats a spectator from the roster', async ({
  browser,
}) => {
  if (!table) throw new Error('table not started');
  const dmContext = await browser.newContext();
  const dm = await dmContext.newPage();
  const errors: string[] = [];
  dm.on('pageerror', (e) => errors.push(e.message));
  await dm.goto(`${table.clientUrl.replace(/\/$/, '')}/#host=${table.hostToken}`);
  await expect(dm.getByRole('status')).toHaveText('Connected to New campaign');
  await expect(dm.getByLabel('Current identity')).toContainText('DM');
  await expect(dm.getByLabel('Current identity')).toContainText('Host');
  // The DM link skips the join screen.
  await expect(dm.getByRole('dialog')).toHaveCount(0);
  await dm.getByRole('button', { name: 'Participants' }).click();
  await addSeat(dm, 'Wizard');
  await addSeat(dm, 'Rogue');

  // First visit: the name comes first, and the host sees no connection until it is chosen.
  const zara = await openClient(browser, table, 'zara', { joinScreen: true });
  const zaraFrames = recordPageFrames(zara.page);
  await expect(zara.page.getByRole('dialog', { name: 'Join the table' })).toBeVisible();
  await expect(zara.page.getByLabel('Display name')).toHaveValue('');
  await expect(zara.page.getByRole('button', { name: 'Continue' })).toBeDisabled();
  await zara.page.getByLabel('Display name').fill('  Zara the Bold  ');
  await zara.page.getByRole('button', { name: 'Continue' }).click();

  await expect(zara.page.getByRole('heading', { name: 'Welcome, Zara the Bold' })).toBeVisible();
  await expect(zara.page.getByRole('radio', { name: /Wizard/ })).toBeEnabled();
  await expect(zara.page.getByRole('button', { name: 'Join as spectator' })).toBeVisible();

  const shots = process.env['JOIN_SHOTS'];
  if (shots) {
    mkdirSync(shots, { recursive: true });
    for (const [w, h] of [
      [1280, 720],
      [390, 844],
    ] as const) {
      await zara.page.setViewportSize({ width: w, height: h });
      await zara.page.screenshot({ path: join(shots, `join-seat-${String(w)}.png`) });
    }
    await zara.page.setViewportSize({ width: 1280, height: 720 });
  }

  // The DM roster lists the unseated visitor under the name they chose.
  await expect(dm.getByLabel('Connected participant for Wizard')).toContainText('Zara the Bold');

  await zara.page.getByRole('radio', { name: /Wizard/ }).check();
  await zara.page.getByRole('button', { name: 'Join participant slot' }).click();
  await expect(zara.page.getByRole('dialog')).toHaveCount(0);
  await expect(zara.page.getByRole('status')).toHaveText('Connected to New campaign');
  await expect(zara.page.getByLabel('Current identity')).toContainText('Zara the Bold');
  await expect(zara.page.getByLabel('Current identity')).toContainText('Player');
  await expect(zara.page.getByLabel('Current identity')).toContainText('Wizard');
  await expect(
    dm.getByRole('list', { name: 'Connected identities' }).getByText('Zara the Bold'),
  ).toBeVisible();
  await expect(
    dm.getByRole('listitem').filter({ hasText: 'Wizard' }).getByText('Online'),
  ).toBeVisible();

  // SES-06: the same browser comes back into the same seat, no screen.
  await zara.page.reload();
  await expect(zara.page.getByRole('status')).toHaveText('Connected to New campaign');
  await expect(zara.page.getByRole('dialog')).toHaveCount(0);

  // A second visitor sees the Wizard seat as taken.
  const quinn = await openClient(browser, table, 'quinn', { joinScreen: true });
  const quinnFrames = recordPageFrames(quinn.page);
  await quinn.page.getByLabel('Display name').fill('Quinn');
  await quinn.page.getByRole('button', { name: 'Continue' }).click();
  await expect(quinn.page.getByRole('radio', { name: /Wizard/ })).toBeDisabled();
  await expect(quinn.page.getByText('Taken')).toBeVisible();
  await quinn.page.getByRole('button', { name: 'Join as spectator' }).click();
  await expect(quinn.page.getByRole('dialog')).toHaveCount(0);
  await expect(quinn.page.getByLabel('Current identity')).toContainText('Quinn');
  await expect(quinn.page.getByLabel('Current identity')).toContainText('Spectator');
  await expect(dm.getByRole('list', { name: 'Connected identities' })).toContainText('Quinn');
  await expect(dm.getByRole('list', { name: 'Connected identities' })).toContainText('Unseated');

  // The DM seats the spectator from the dropdown, not by typing an identity id.
  const rogue = dm
    .getByRole('list', { name: 'Seats' })
    .getByRole('listitem')
    .filter({ hasText: 'Rogue' });
  const picker = rogue.getByLabel('Connected participant for Rogue');
  const value = await picker.locator('option', { hasText: 'Quinn' }).getAttribute('value');
  await picker.selectOption(value ?? '');
  await rogue.getByRole('button', { name: 'Assign' }).click();
  await expect(rogue.getByText('Quinn', { exact: true })).toBeVisible();
  await expect(rogue.getByText('Online')).toBeVisible();
  await expect(quinn.page.getByLabel('Current identity')).toContainText('Player');
  await expect(quinn.page.getByLabel('Current identity')).toContainText('Rogue');

  // PERM-03: no roster or other names ever reach player or spectator sockets.
  for (const frames of [zaraFrames, quinnFrames]) {
    expect(frames.some((f) => f.includes('"t":"presence"'))).toBe(false);
    expect(frames.join('\n')).not.toContain('unseated');
  }
  expect(quinnFrames.join('\n')).not.toContain('Zara the Bold');
  expect(errors).toEqual([]);

  await zara.context.close();
  await quinn.context.close();
  await dmContext.close();
});
