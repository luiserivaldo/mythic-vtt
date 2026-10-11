import { mkdtemp, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { Campaign, CURRENT_SCHEMA_VERSION, storeMigrate } from '@mythic/shared';
import { LocalCampaignStore } from './local-campaign-store.js';

it('preserves text and roll scrollback through v4 load/save and nested snapshot migration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mythic-chat-save-'));
  const source = fileURLToPath(new URL('../../../../fixtures/saves/v4/campaigns', import.meta.url));
  await cp(source, join(root, 'campaigns'), { recursive: true });
  const store = new LocalCampaignStore(root, storeMigrate);
  try {
    const id = '01J8Z0000000000000000CAMP1';
    const loaded = await store.load(id);
    expect(loaded.campaign.chat).toHaveLength(2);
    expect(loaded.campaign.chat?.[1]).toMatchObject({ kind: 'roll', result: { total: 16 } });
    await store.saveCampaign(id, loaded.campaign);
    expect((await store.load(id)).campaign.chat).toEqual(loaded.campaign.chat);
    const state = {
      ...loaded.campaign,
      schemaVersion: 3,
      scenes: Object.fromEntries(loaded.scenes.map((s) => [s.id, s])),
    };
    const old = { schemaVersion: 3, state };
    const migrated = storeMigrate('snapshot', 3, old) as { state: unknown };
    expect(Campaign.parse(migrated.state).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(Campaign.parse(migrated.state).chat).toEqual(state.chat);
    expect(old.state.schemaVersion).toBe(3);
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});
