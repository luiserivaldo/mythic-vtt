import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, storeMigrate } from '@mythic/shared';
import { CampaignFile, LocalCampaignStore } from '../storage/index.js';
import { createEngine } from './engine.js';
import { recoverCampaign, saveCampaignCheckpoint } from './recovery.js';
import { T, fakeConnection, fixtureCampaign, tid } from './testing.js';

const LABEL = 'TEMP-SEAT-DISPLAY-NAME';
let dir: string | undefined;
let store: LocalCampaignStore | undefined;

afterEach(async () => {
  await store?.close();
  store = undefined;
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

/** Every file under `root`, except the append-only action log (the session's replay record). */
async function savedFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) out.push(...(await savedFiles(path)));
    else if (entry.name !== 'log.jsonl') out.push(path);
  }
  return out;
}

it('never writes a temporary seat, its name or its ownership to a saved file', async () => {
  dir = await mkdtemp(join(tmpdir(), 'mythic-temp-seat-'));
  const campaign = fixtureCampaign();
  const sessionId = tid(25);
  store = new LocalCampaignStore(dir, storeMigrate);
  await store.saveCampaign(campaign.id, CampaignFile.parse(campaign));
  for (const scene of Object.values(campaign.scenes)) await store.saveScene(campaign.id, scene);
  await store.startSession(
    campaign.id,
    { schemaVersion: CURRENT_SCHEMA_VERSION, sessionId, startedAt: 1 },
    { seq: 0, state: campaign },
  );
  const engine = createEngine({
    campaign,
    sessionId,
    store,
    // Checkpoint after every action, as the strictest autosave setting would.
    onApplied: async (state, seq) => {
      await saveCampaignCheckpoint(
        store as LocalCampaignStore,
        state,
        sessionId,
        seq,
        'autosave',
        seq,
      );
    },
  });
  const host = fakeConnection(T.host, { isHost: true });
  const carol = Object.assign(fakeConnection(T.carol), { displayName: 'Carol' });
  await engine.onConnect(host);
  await engine.onConnect(carol);
  await engine.onJoin(carol, { t: 'join', as: 'temporary', label: LABEL });
  await engine.idle();
  const seat = Object.values(engine.state().seats).find((s) => s.temporary);
  expect(seat?.label).toBe(LABEL);
  // The DM makes a token for it; the token must be saved, the ownership of it must not.
  await engine.onIntent(host, {
    t: 'intent',
    type: 'entity.setOwners',
    payload: { sceneId: T.scene, entityId: T.token, owners: [seat?.id ?? ''] },
    clientRef: 'own',
  });
  await engine.idle();
  expect(engine.state().scenes[T.scene]?.entities[T.token]?.owners).toEqual([seat?.id]);

  // Mid-session checkpoint (autosave) and the end-of-session save.
  await saveCampaignCheckpoint(store, engine.state(), sessionId, engine.seq(), 'end', 2);
  const files = await savedFiles(dir);
  expect(files.length).toBeGreaterThan(2);
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    expect(text, file).not.toContain(LABEL);
    expect(text, file).not.toContain(seat?.id ?? 'unreachable');
    expect(text, file).not.toContain(T.carol);
  }
  const loaded = await store.load(campaign.id);
  expect(Object.keys(loaded.campaign.seats).sort()).toEqual([T.seatA, T.seatB, T.coDm].sort());
  expect(loaded.scenes[0]?.entities[T.token]).toBeDefined();
  expect(loaded.scenes[0]?.entities[T.token]?.owners).toEqual([]);
});

it('drops a temporary seat when a crashed session is recovered from its log', async () => {
  dir = await mkdtemp(join(tmpdir(), 'mythic-temp-seat-'));
  const campaign = fixtureCampaign();
  const sessionId = tid(26);
  store = new LocalCampaignStore(dir, storeMigrate);
  await store.saveCampaign(campaign.id, CampaignFile.parse(campaign));
  for (const scene of Object.values(campaign.scenes)) await store.saveScene(campaign.id, scene);
  await store.startSession(
    campaign.id,
    { schemaVersion: CURRENT_SCHEMA_VERSION, sessionId, startedAt: 1 },
    { seq: 0, state: campaign },
  );
  // No checkpoint after the join: only the log holds the temporary seat when the host dies.
  const engine = createEngine({ campaign, sessionId, store });
  const carol = fakeConnection(T.carol);
  await engine.onConnect(carol);
  await engine.onJoin(carol, { t: 'join', as: 'temporary', label: LABEL });
  await engine.idle();
  await store.flushLogs();
  expect(Object.values(engine.state().seats).some((s) => s.temporary)).toBe(true);

  const recovered = await recoverCampaign(store, campaign);
  expect(recovered.seq).toBe(1);
  expect(Object.values(recovered.campaign.seats).some((s) => s.temporary)).toBe(false);
  expect(JSON.stringify(recovered.campaign)).not.toContain(LABEL);
});
