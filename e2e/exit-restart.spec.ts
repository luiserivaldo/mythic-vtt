import { expect, test, type Page } from '@playwright/test';
import { recordPageFrames, seedProfile, startTable } from './harness.js';

interface SnapshotFrame {
  t: 'snapshot';
  seq: number;
  state: {
    scenes: Record<
      string,
      {
        name: string;
        entities: Record<
          string,
          { name: string; transform: { position: { x: number; y: number; z: number } } }
        >;
      }
    >;
  };
}

const snapshots = (frames: readonly string[]): SnapshotFrame[] =>
  frames
    .map((frame) => JSON.parse(frame) as { t: string })
    .filter((frame): frame is SnapshotFrame => frame.t === 'snapshot');

const highestSeq = (frames: readonly string[]): number =>
  Math.max(
    ...frames.map((frame) => {
      const message = JSON.parse(frame) as { seq?: number };
      return message.seq ?? -1;
    }),
  );

async function dragToken(page: Page, from: { x: number; z: number }, by: { x: number; z: number }) {
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('scene canvas has no bounds');
  const zoom = Math.min(box.width / 42, box.height / 32);
  const point = (position: { x: number; z: number }) => ({
    x: box.x + box.width / 2 + (position.x - 20) * zoom,
    y: box.y + box.height / 2 + (position.z - 15) * zoom,
  });
  const start = point(from);
  await page.mouse.click(start.x, start.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + by.x * zoom, start.y + by.z * zoom, { steps: 8 });
  await page.mouse.up();
}

test('M0 exit: browser sync survives clean and SIGKILL host restarts', async ({ browser }) => {
  test.setTimeout(60_000);
  const table = await startTable();
  const dmContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const playerContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const dm = await dmContext.newPage();
  const player = await playerContext.newPage();
  const dmFrames = recordPageFrames(dm);
  const playerFrames = recordPageFrames(player);
  await seedProfile(playerContext, 'player');

  try {
    await Promise.all([
      dm.goto(`${table.clientUrl}/#host=${table.hostToken}`),
      player.goto(table.clientUrl),
    ]);
    await expect(dm.getByRole('status')).toHaveText('Connected to New campaign');
    await expect(player.getByRole('status')).toHaveText('Connected to New campaign');

    await dm.getByRole('button', { name: 'Scenes', exact: true }).click();
    await dm.getByLabel('New scene name').fill('M0 persistent scene');
    await dm.getByRole('button', { name: 'Create scene' }).click();
    await dm.getByRole('button', { name: 'Entities', exact: true }).click();
    await dm.getByLabel('Token name').fill('Persistent knight');
    await dm.getByRole('button', { name: 'Create token' }).click();
    await dm.getByLabel('Token name').fill('Persistent mage');
    await dm.getByRole('button', { name: 'Create token' }).click();
    await dm
      .locator('.ui-drawer')
      .getByRole('button', { name: /^Close/ })
      .click();

    // Browser A performs a real token drag; browser B must render the resulting durable action.
    const beforeFirstMove = highestSeq(playerFrames);
    await dragToken(dm, { x: 20.5, z: 15.5 }, { x: 2, z: 1 });
    await expect.poll(() => highestSeq(playerFrames)).toBeGreaterThan(beforeFirstMove);
    await expect(player.getByTestId('token-label')).toHaveText([
      'Persistent knight',
      'Persistent mage',
    ]);
    const beforeCleanSeq = highestSeq(playerFrames);

    const snapshotsBeforeClean = snapshots(playerFrames).length;
    const dmSnapshotsBeforeClean = snapshots(dmFrames).length;
    await table.restart('SIGTERM');
    await expect.poll(() => snapshots(playerFrames).length).toBeGreaterThan(snapshotsBeforeClean);
    await expect.poll(() => snapshots(dmFrames).length).toBeGreaterThan(dmSnapshotsBeforeClean);
    const clean = snapshots(playerFrames).at(-1);
    if (!clean) throw new Error('player did not receive a clean-restart snapshot');
    expect(clean.seq).toBeGreaterThanOrEqual(beforeCleanSeq);
    const foundScene = Object.entries(clean.state.scenes).find(
      ([, candidate]) => candidate.name === 'M0 persistent scene',
    );
    if (!foundScene) throw new Error('persistent scene missing after clean restart');
    const [sceneId, scene] = foundScene;
    const knight = Object.values(scene.entities).find(
      (entity) => entity.name === 'Persistent knight',
    );
    const mage = Object.values(scene.entities).find((entity) => entity.name === 'Persistent mage');
    if (!knight || !mage) throw new Error('persistent entities missing after clean restart');
    expect(knight.transform.position).toEqual({ x: 22.5, y: 0, z: 16.5 });
    expect(mage.transform.position).toEqual({ x: 21.5, y: 0, z: 16.5 });

    await dragToken(dm, knight.transform.position, { x: 2, z: 0 });
    await expect.poll(() => highestSeq(playerFrames)).toBeGreaterThan(clean.seq);
    const beforeKillSeq = highestSeq(playerFrames);

    // TECHNICAL §8.3 batches log fsync for at most 500 ms. Waiting one full interval plus
    // scheduling margin makes this a recovery test, not an assertion about an unflushed tail.
    await new Promise((resolve) => setTimeout(resolve, 600));
    const snapshotsBeforeKill = snapshots(playerFrames).length;
    const dmSnapshotsBeforeKill = snapshots(dmFrames).length;
    await table.restart('SIGKILL');
    await expect.poll(() => snapshots(playerFrames).length).toBeGreaterThan(snapshotsBeforeKill);
    await expect.poll(() => snapshots(dmFrames).length).toBeGreaterThan(dmSnapshotsBeforeKill);
    const crashed = snapshots(playerFrames).at(-1);
    if (!crashed) throw new Error('player did not receive a crash-recovery snapshot');
    expect(crashed.seq).toBe(beforeKillSeq);
    const recoveredScene = crashed.state.scenes[sceneId];
    expect(Object.keys(recoveredScene?.entities ?? {})).toHaveLength(2);
    expect(
      Object.values(recoveredScene?.entities ?? {}).find(
        (entity) => entity.name === 'Persistent knight',
      )?.transform.position,
    ).toEqual({ x: 24.5, y: 0, z: 16.5 });
    expect(
      Object.values(recoveredScene?.entities ?? {}).find(
        (entity) => entity.name === 'Persistent mage',
      )?.transform.position,
    ).toEqual({ x: 21.5, y: 0, z: 16.5 });

    // A post-recovery action proves sequence assignment continues rather than restarting.
    await dragToken(dm, { x: 24.5, z: 16.5 }, { x: 0, z: 2 });
    await expect.poll(() => highestSeq(playerFrames)).toBeGreaterThan(crashed.seq);
    await expect(player.getByTestId('token-label')).toHaveCount(2);
    await expect(dm.getByRole('status')).toHaveText('Connected to New campaign');
  } finally {
    await Promise.all([dmContext.close(), playerContext.close()]);
    await table.stop();
  }
});
