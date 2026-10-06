import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { storeMigrate } from '@mythic/shared';
import { loadConfig } from '../config.js';
import { startHost, type RunningHost } from '../server.js';
import { CampaignFile, LocalCampaignStore } from '../storage/index.js';
import { createEngine } from './engine.js';
import { saveCampaignCheckpoint } from './recovery.js';
import { T, fakeConnection, fixtureCampaign, tid } from './testing.js';

let dir: string | undefined;
let abandoned: LocalCampaignStore | undefined;
let restarted: RunningHost | undefined;

afterEach(async () => {
  await restarted?.close();
  restarted = undefined;
  await abandoned?.close();
  abandoned = undefined;
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

it('recovers an unclean session from the checkpoint and complete log tail', async () => {
  dir = await mkdtemp(join(tmpdir(), 'mythic-recovery-'));
  const campaign = fixtureCampaign();
  const sessionId = tid(25);
  const store = new LocalCampaignStore(dir, storeMigrate);
  abandoned = store;
  await store.saveCampaign(campaign.id, CampaignFile.parse(campaign));
  for (const scene of Object.values(campaign.scenes)) await store.saveScene(campaign.id, scene);
  await store.startSession(
    campaign.id,
    { schemaVersion: 1, sessionId, startedAt: 1 },
    {
      seq: 0,
      state: campaign,
    },
  );
  const engine = createEngine({
    campaign,
    sessionId,
    store,
    onApplied: async (state, seq) => {
      if (seq === 2) await saveCampaignCheckpoint(store, state, sessionId, seq, 'autosave');
    },
  });
  const dm = fakeConnection(T.host, { isHost: true });
  await engine.onConnect(dm);
  for (const [index, name] of ['First', 'Second', 'Third'].entries()) {
    await engine.onIntent(dm, {
      t: 'intent',
      type: 'scene.rename',
      payload: { sceneId: T.scene, name },
      clientRef: `r${String(index)}`,
    });
  }
  expect(engine.seq()).toBe(3);
  const sessionDir = join(dir, 'campaigns', campaign.id, 'sessions', sessionId);
  expect(JSON.parse(await readFile(join(sessionDir, 'meta.json'), 'utf8'))).toMatchObject({
    sessionId,
  });
  expect(JSON.parse(await readFile(join(sessionDir, 'start.snapshot.json'), 'utf8'))).toMatchObject(
    { seq: 0 },
  );
  expect(
    JSON.parse(await readFile(join(sessionDir, 'snapshots', 'autosave.json'), 'utf8')),
  ).toMatchObject({ seq: 2 });
  await appendFile(join(sessionDir, 'log.jsonl'), '{"envelope":');

  // No engine/store shutdown and no end snapshot: equivalent to an unclean stop. The new
  // process must ignore the torn final line and replay action 3 after the saved seq 2.
  restarted = await startHost(loadConfig({ MYTHIC_DATA_DIR: dir, MYTHIC_PORT: '0' }));
  expect(restarted.engine.seq()).toBe(3);
  expect(restarted.engine.state().scenes[T.scene]?.name).toBe('Third');
  const next = fakeConnection(T.host, { isHost: true });
  await restarted.engine.onConnect(next);
  await restarted.engine.onIntent(next, {
    t: 'intent',
    type: 'scene.rename',
    payload: { sceneId: T.scene, name: 'Fourth' },
    clientRef: 'next',
  });
  expect(restarted.engine.seq()).toBe(4);
});
