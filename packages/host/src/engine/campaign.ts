import { CURRENT_SCHEMA_VERSION, Campaign, blankScene } from '@mythic/shared';
import { CampaignFile, type CampaignStore } from '../storage/types.js';
import { ulid, type Clock, type RandomSource } from './sources.js';

/** Defaults for a brand-new campaign (§5). One blank active scene; further changes go through actions. */
export function newCampaign(id: string, name: string): Campaign {
  return {
    id,
    name,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    settings: {
      defaultBinding: 'persistent',
      instanceMode: 'linked',
      spectators: { enabled: false, view: 'players' },
    },
    seats: {},
    scenes: { [id]: blankScene(id) },
    activeSceneId: id,
  };
}

/** Rebuilds the in-memory `Campaign` from the store's split files (campaign.json + scenes/). */
export async function loadCampaign(store: CampaignStore, campaignId: string): Promise<Campaign> {
  const { campaign, scenes } = await store.load(campaignId);
  if (scenes.length === 0) {
    const initial = blankScene(campaignId);
    await store.saveScene(campaignId, initial);
    const repaired = { ...campaign, activeSceneId: initial.id };
    await store.saveCampaign(campaignId, repaired);
    return Campaign.parse({ ...repaired, scenes: { [initial.id]: initial } });
  }
  return Campaign.parse({ ...campaign, scenes: Object.fromEntries(scenes.map((s) => [s.id, s])) });
}

/**
 * Opens the requested campaign, else the most recently updated one, else creates and saves a new
 * one. Replaying the log tail on top of the files is crash recovery (M0-11), not done here.
 */
export async function loadOrCreateCampaign(
  store: CampaignStore,
  options: { clock: Clock; random: RandomSource; campaignId?: string; name?: string },
): Promise<Campaign> {
  const id = options.campaignId ?? (await store.list())[0]?.id;
  if (id !== undefined) return loadCampaign(store, id);
  const created = newCampaign(
    ulid(options.clock(), options.random),
    options.name ?? 'New campaign',
  );
  // Persist the initial scene before the campaign advertises its active ID.
  for (const scene of Object.values(created.scenes)) await store.saveScene(created.id, scene);
  await store.saveCampaign(created.id, CampaignFile.parse(created));
  return created;
}
