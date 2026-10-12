import { expect, test, type Page } from '@playwright/test';
import { startTable, type Table } from './harness.js';

// UX-24 / UI-CHAT-01: the Chat tab is a message log with a disabled composer until M4-22/M4-23.
let table: Table | undefined;

test.beforeAll(async () => {
  table = await startTable();
});
test.afterAll(async () => {
  await table?.stop();
});

/** The empty Chat panel: its log, the coming-soon note, and a composer nobody can use yet. */
async function expectChatPanel(page: Page): Promise<void> {
  const panel = page.getByRole('region', { name: 'Chat' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('log', { name: 'Chat messages' })).toBeVisible();
  await expect(panel.getByText('No messages yet.')).toBeVisible();
  await expect(panel.getByLabel('Message', { exact: true })).toBeDisabled();
  await expect(panel.getByRole('button', { name: 'Send' })).toBeDisabled();
  await expect(panel.getByText(/Chat is coming soon/)).toBeVisible();
  // No dice hotkey chips: the composer holds nothing but the send button.
  await expect(panel.getByRole('button')).toHaveCount(1);
}

test('the DM and a player both open the Chat tab and find a disabled composer', async ({
  browser,
}) => {
  if (!table) throw new Error('table not started');
  const errors: string[] = [];
  const dmContext = await browser.newContext();
  const dm = await dmContext.newPage();
  dm.on('pageerror', (error) => errors.push(error.message));
  await dm.goto(`${table.clientUrl.replace(/\/$/, '')}/#host=${table.hostToken}`);
  await expect(dm.getByRole('status')).toHaveText('Connected to New campaign');

  // One Player slot for the guest: participants are dock tabs, not toolbar buttons.
  await dm.getByRole('tab', { name: 'Participants', exact: true }).click();
  await dm.getByRole('button', { name: 'Add Player' }).click();

  await dm.getByRole('tab', { name: 'Chat', exact: true }).click();
  await expectChatPanel(dm);

  const playerContext = await browser.newContext();
  const player = await playerContext.newPage();
  player.on('pageerror', (error) => errors.push(error.message));
  await player.goto(table.clientUrl);
  await player.getByLabel('Display name').fill('Chat Player');
  await player.getByRole('button', { name: 'Continue', exact: true }).click();
  await player.getByRole('radio', { name: /Player/ }).check();
  await player.getByRole('button', { name: 'Join participant slot', exact: true }).click();
  await expect(player.getByRole('status')).toHaveText('Connected to New campaign');

  await player.getByRole('tab', { name: 'Chat', exact: true }).click();
  await expectChatPanel(player);

  expect(errors).toEqual([]);
  await playerContext.close();
  await dmContext.close();
});
