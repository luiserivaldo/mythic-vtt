import { expect, test } from '@playwright/test';
import { RawClient, recordPageFrames, startTable, testUlid, type Table } from './harness.js';

// UX-23: the right dock is an icon tab strip whose tabs depend on the viewer's role.
let table: Table | undefined;

test.beforeAll(async () => {
  table = await startTable();
});
test.afterAll(async () => {
  await table?.stop();
});

const PLAYER_TABS = ['Chat', 'Sheet', 'Help', 'Settings'];
const DM_ONLY_TABS = ['Scenes', 'Layers', 'Map', 'Entities', 'Prefabs', 'Participants', 'Invite'];

test('players get four tabs, never render DM tabs, and the DM sees them all', async ({
  browser,
}) => {
  if (!table) throw new Error('table not started');
  const errors: string[] = [];
  const dmContext = await browser.newContext();
  const dm = await dmContext.newPage();
  dm.on('pageerror', (error) => errors.push(error.message));
  await dm.goto(`${table.clientUrl.replace(/\/$/, '')}/#host=${table.hostToken}`);
  await expect(dm.getByRole('status')).toHaveText('Connected to New campaign');

  // The DM sees every tab and the dock opens on Chat.
  const dmTabs = dm.getByRole('tablist', { name: 'Dock tabs' });
  for (const name of [...PLAYER_TABS, ...DM_ONLY_TABS])
    await expect(dmTabs.getByRole('tab', { name, exact: true })).toBeVisible();
  await expect(dmTabs.getByRole('tab', { name: 'Chat', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  // Seed a secret DM-layer token and a participant template for the guest.
  const hostIdentity = await dm.evaluate(
    () =>
      JSON.parse(localStorage.getItem('mythic.identity.v1') ?? '{}') as {
        identityId: string;
        identitySecret: string;
      },
  );
  const setup = await RawClient.connect(table, { name: 'dock-setup', ...hostIdentity });
  await setup.waitFor('host snapshot', () => setup.state !== undefined);
  const sceneId = testUlid('SCENE', 230);
  const secretId = testUlid('SECRET', 230);
  expect((await setup.intent('scene.create', { sceneId, name: 'Dock scene' })).t).toBe('ack');
  expect(
    (
      await setup.intent('entity.create', {
        sceneId,
        entity: {
          id: secretId,
          layer: 'dm',
          name: 'SECRET DOCK TOKEN',
          owners: [],
          transform: {
            position: { x: 12, y: 0, z: 10 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
          },
          token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
        },
      })
    ).t,
  ).toBe('ack');
  await dm.getByRole('tab', { name: 'Participants', exact: true }).click();
  await dm.getByRole('button', { name: 'Add Spectator' }).click();

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  const frames = recordPageFrames(guest);
  guest.on('pageerror', (error) => errors.push(error.message));
  await guest.goto(table.clientUrl);
  await guest.getByLabel('Display name').fill('Dock Guest');
  await guest.getByRole('button', { name: 'Continue' }).click();
  await guest.getByRole('radio', { name: /Spectator/ }).check();
  await guest.getByRole('button', { name: 'Join participant slot' }).click();
  await expect(guest.getByRole('status')).toHaveText('Connected to New campaign');

  const guestTabs = guest.getByRole('tablist', { name: 'Dock tabs' });
  await expect(guestTabs.getByRole('tab')).toHaveCount(PLAYER_TABS.length);
  for (const name of PLAYER_TABS)
    await expect(guestTabs.getByRole('tab', { name, exact: true })).toBeVisible();
  for (const name of DM_ONLY_TABS)
    await expect(guest.getByRole('tab', { name, exact: true })).toHaveCount(0);
  await expect(guestTabs.getByRole('tab', { name: 'Chat', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  // Leak test: no DM panel renders in the player's DOM in any tab, and the secret never arrives.
  for (const name of PLAYER_TABS) {
    await guest.getByRole('tab', { name, exact: true }).click();
    await expect(guest.getByRole('region', { name: 'Entities' })).toHaveCount(0);
    await expect(guest.getByRole('region', { name: 'Layers' })).toHaveCount(0);
    await expect(guest.getByRole('region', { name: 'Scenes' })).toHaveCount(0);
    await expect(guest.getByLabel('New scene name')).toHaveCount(0);
    await expect(guest.getByLabel('Token name')).toHaveCount(0);
  }
  await expect(guest.getByText('SECRET DOCK TOKEN')).toHaveCount(0);
  expect(await guest.content()).not.toContain('SECRET DOCK TOKEN');
  expect(frames.join('\n')).not.toContain(secretId);

  // Collapse leaves a column of icon tabs; picking one expands the dock again.
  const dock = dm.getByRole('complementary', { name: 'Right dock' });
  await dm.getByRole('button', { name: 'Collapse dock' }).click();
  await expect(dock).toHaveAttribute('data-collapsed', 'true');
  await expect(dm.getByRole('tab', { name: 'Entities', exact: true })).toBeVisible();
  const column = async () => {
    const chat = await dm.getByRole('tab', { name: 'Chat', exact: true }).boundingBox();
    const sheet = await dm.getByRole('tab', { name: 'Sheet', exact: true }).boundingBox();
    return { sameX: chat?.x === sheet?.x, below: (sheet?.y ?? 0) > (chat?.y ?? 0) };
  };
  await expect.poll(column).toEqual({ sameX: true, below: true });
  await dm.getByRole('tab', { name: 'Entities', exact: true }).click();
  await expect(dock).toHaveAttribute('data-collapsed', 'false');
  await expect(dm.getByLabel('Token name')).toBeVisible();

  expect(errors).toEqual([]);
  await setup.close();
  await guestContext.close();
  await dmContext.close();
});
