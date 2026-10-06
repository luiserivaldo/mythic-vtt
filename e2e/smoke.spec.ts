import { expect, test } from '@playwright/test';
import { openTable, type OpenTable } from './harness.js';

const PLAYERS = 3;
let opened: OpenTable | undefined;

function table(): OpenTable {
  if (!opened) throw new Error('table not started');
  return opened;
}

test.beforeAll(async ({ browser }) => {
  opened = await openTable(browser, PLAYERS);
});

test.afterAll(async () => {
  await opened?.close();
});

test('a DM and N players connect and complete hello', async () => {
  const everyone = [table().dm, ...table().players];

  for (const c of everyone) {
    await expect(c.page.getByRole('status')).toHaveText('Connection: open');
  }
  // `authenticated` only counts connections that got past `hello`, not merely open sockets.
  await expect
    .poll(async () => (await table().table.connections()).authenticated)
    .toBe(everyone.length);

  // Separate contexts mean separate identities (SES-02).
  const ids = await Promise.all(
    everyone.map((c) => c.page.evaluate(() => localStorage.getItem('mythic.identity.v1'))),
  );
  expect(new Set(ids).size).toBe(everyone.length);
});

test('closing a client drops its connection', async () => {
  const leaver = table().players[0];
  if (!leaver) throw new Error('no player');
  const before = (await table().table.connections()).authenticated;
  await leaver.context.close();
  await expect.poll(async () => (await table().table.connections()).authenticated).toBe(before - 1);
});
