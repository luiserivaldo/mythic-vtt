import { loadCampaign } from './campaign.js';
import { CURRENT_SCHEMA_VERSION } from '@mythic/shared';
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { storeMigrate } from '@mythic/shared';
import { loadConfig } from '../config.js';
import { startHost, type RunningHost } from '../server.js';
import { CampaignFile, LocalCampaignStore } from '../storage/index.js';
import { createEngine } from './engine.js';
import { recoverCampaign, saveCampaignCheckpoint } from './recovery.js';
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
    { schemaVersion: CURRENT_SCHEMA_VERSION, sessionId, startedAt: 1 },
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

it('checkpoint removes deleted scene files and preserves the remaining private scene', async () => {
  dir = await mkdtemp(join(tmpdir(), 'mythic-scene-delete-'));
  const campaign = fixtureCampaign();
  const scene = campaign.scenes[T.scene];
  if (!scene) throw new Error('fixture lacks scene');
  const privateId = tid(28);
  campaign.scenes[privateId] = { ...structuredClone(scene), id: privateId, dmOnly: true };
  const store = new LocalCampaignStore(dir, storeMigrate);
  abandoned = store;
  await store.saveCampaign(campaign.id, CampaignFile.parse(campaign));
  for (const entry of Object.values(campaign.scenes)) await store.saveScene(campaign.id, entry);
  Reflect.deleteProperty(campaign.scenes, T.scene);
  campaign.activeSceneId = null;
  await saveCampaignCheckpoint(store, campaign, tid(25), 1, 'autosave');
  const loaded = await store.load(campaign.id);
  expect(loaded.scenes.map((entry) => entry.id)).toEqual([privateId]);
  expect(loaded.campaign.activeSceneId).toBeNull();
});

it('migrates and persists a zero-scene split save as one blank active scene', async () => {
  dir = await mkdtemp(join(tmpdir(), 'mythic-empty-save-'));
  const campaign = { ...fixtureCampaign(), scenes: {}, activeSceneId: null };
  const store = new LocalCampaignStore(dir, storeMigrate);
  abandoned = store;
  await store.saveCampaign(campaign.id, CampaignFile.parse(campaign));
  await writeFile(
    join(dir, 'campaigns', campaign.id, 'campaign.json'),
    JSON.stringify({ ...CampaignFile.parse(campaign), schemaVersion: 2 }),
  );
  const loaded = await loadCampaign(store, campaign.id);
  expect(Object.keys(loaded.scenes)).toHaveLength(1);
  expect(loaded.scenes[loaded.activeSceneId ?? '']).toMatchObject({
    name: 'Blank scene',
    dmOnly: false,
  });
  const reloaded = await store.load(campaign.id);
  expect(reloaded.scenes).toHaveLength(1);
  expect(reloaded.campaign.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  expect(reloaded.campaign.activeSceneId).toBe(loaded.activeSceneId);
});

it('recovers v3 snapshots and unversioned legacy pin creates/updates without marking saves corrupt', async () => {
  dir = await mkdtemp(join(tmpdir(), 'mythic-pin-recovery-'));
  const campaign = fixtureCampaign(),
    sessionId = tid(25);
  const store = new LocalCampaignStore(dir, storeMigrate);
  abandoned = store;
  await store.saveCampaign(campaign.id, CampaignFile.parse(campaign));
  for (const scene of Object.values(campaign.scenes)) await store.saveScene(campaign.id, scene);
  await store.startSession(
    campaign.id,
    { schemaVersion: CURRENT_SCHEMA_VERSION, sessionId, startedAt: 1 },
    { seq: 0, state: campaign },
  );
  const oldPin = { text: '', reveal: 'click' };
  const oldState = {
    ...campaign,
    schemaVersion: 3,
    scenes: {
      ...campaign.scenes,
      [T.scene]: {
        ...campaign.scenes[T.scene],
        entities: {
          ...campaign.scenes[T.scene]?.entities,
          [T.token]: { ...campaign.scenes[T.scene]?.entities[T.token], pin: oldPin },
        },
      },
    },
  };
  const sessionDir = join(dir, 'campaigns', campaign.id, 'sessions', sessionId);
  await writeFile(
    join(sessionDir, 'start.snapshot.json'),
    JSON.stringify({ schemaVersion: 3, seq: 0, state: oldState }),
  );
  const oversized = { text: 'q'.repeat(5000), reveal: 'hover', extra: 'preserve' };
  const entity = campaign.scenes[T.scene]?.entities[T.token];
  if (!entity) throw new Error('entity');
  const entries = [
    {
      type: 'entity.create',
      payload: { sceneId: T.scene, entity: { ...entity, id: tid(26), pin: oversized } },
    },
    {
      type: 'entity.update',
      payload: { sceneId: T.scene, entityId: T.token, changes: { pin: oversized } },
    },
    {
      type: 'entity.update',
      payload: { sceneId: T.scene, entityId: tid(26), changes: { pin: oldPin } },
    },
  ].map((action, index) => ({
    envelope: {
      ...action,
      id: tid(27 + index),
      actor: { kind: 'host' },
      campaignId: campaign.id,
      sessionId,
      sceneId: T.scene,
      ts: index + 2,
      seq: index + 1,
    },
    inversePatches: [],
  }));
  const rawLog = entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
  await writeFile(join(sessionDir, 'log.jsonl'), rawLog);
  const recovered = await recoverCampaign(store, campaign);
  expect(recovered.seq).toBe(3);
  expect(recovered.campaign.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  expect(recovered.campaign.scenes[T.scene]?.entities[T.token]).toMatchObject({
    pin: { text: 'q'.repeat(4096), reveal: 'hover' },
    legacyPin: oversized,
  });
  expect(recovered.campaign.scenes[T.scene]?.entities[tid(26)]?.pin).toBeUndefined();
  expect(recovered.campaign.scenes[T.scene]?.entities[tid(26)]?.legacyPin).toEqual(oldPin);
  expect(await readFile(join(sessionDir, 'log.jsonl'), 'utf8')).toBe(rawLog);
  await saveCampaignCheckpoint(store, recovered.campaign, sessionId, recovered.seq, 'autosave');
  expect(await recoverCampaign(store, recovered.campaign)).toEqual(recovered);
});
