import { CURRENT_SCHEMA_VERSION, Campaign, blankScene } from '@mythic/shared';
import { CampaignFile, type CampaignMeta, type CampaignStore } from '../storage/types.js';
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

/** The selection flags could not be turned into exactly one campaign; the message lists the options. */
export class CampaignSelectionError extends Error {}

export interface CampaignSelection {
  /** Exact id (`MYTHIC_CAMPAIGN_ID`). */
  campaignId?: string;
  /** Exact id, else a unique case-insensitive name, else a unique id prefix (`--campaign`). */
  campaign?: string;
  /** Create a campaign with this name (`--new-campaign`). */
  newCampaign?: string;
}

const describe = (campaigns: readonly CampaignMeta[]): string =>
  campaigns.length === 0
    ? 'no campaigns exist yet'
    : campaigns.map((c) => `  ${c.id}  ${c.name}`).join('\n');

/**
 * HOST-03: turns the start-up selection into an existing campaign id or a name to create.
 * Without an explicit selection: the only campaign, else `choose` (the interactive picker), else
 * the first in list order: the most recently played (UX-05), then the most recently saved.
 */
export async function selectCampaign(
  store: Pick<CampaignStore, 'list'>,
  selection: CampaignSelection = {},
  choose?: (campaigns: readonly CampaignMeta[]) => Promise<string | undefined>,
): Promise<{ id: string } | { create: string } | undefined> {
  const requested = [selection.campaignId, selection.campaign, selection.newCampaign].filter(
    (value) => value !== undefined,
  );
  if (requested.length > 1)
    throw new CampaignSelectionError(
      'choose one of a campaign id, --campaign and --new-campaign, not several',
    );
  if (selection.newCampaign !== undefined) {
    const name = selection.newCampaign.trim();
    if (name === '') throw new CampaignSelectionError('--new-campaign needs a name');
    return { create: name };
  }
  const campaigns = await store.list();
  const unknown = (what: string) =>
    new CampaignSelectionError(`no campaign matches ${what}; available:\n${describe(campaigns)}`);
  if (selection.campaignId !== undefined) {
    const found = campaigns.find((c) => c.id === selection.campaignId);
    if (!found) throw unknown(`id ${selection.campaignId}`);
    return { id: found.id };
  }
  if (selection.campaign !== undefined) {
    const query = selection.campaign.trim();
    const lower = query.toLowerCase();
    const exact = campaigns.find((c) => c.id === query);
    if (exact) return { id: exact.id };
    for (const matches of [
      campaigns.filter((c) => c.name.toLowerCase() === lower),
      campaigns.filter((c) => lower.length >= 4 && c.id.toLowerCase().startsWith(lower)),
    ]) {
      if (matches.length > 1)
        throw new CampaignSelectionError(
          `"${query}" matches several campaigns; use the id:\n${describe(matches)}`,
        );
      if (matches[0]) return { id: matches[0].id };
    }
    throw unknown(`"${query}"`);
  }
  if (campaigns.length > 1 && choose) {
    const picked = await choose(campaigns);
    if (picked !== undefined) {
      if (!campaigns.some((c) => c.id === picked)) throw unknown(`id ${picked}`);
      return { id: picked };
    }
  }
  return campaigns[0] ? { id: campaigns[0].id } : undefined;
}

/**
 * Opens the selected campaign (see `selectCampaign`), or creates and saves a new one. Replaying
 * the log tail on top of the files is crash recovery (M0-11), not done here.
 */
export async function loadOrCreateCampaign(
  store: CampaignStore,
  options: CampaignSelection & {
    clock: Clock;
    random: RandomSource;
    name?: string;
    choose?: (campaigns: readonly CampaignMeta[]) => Promise<string | undefined>;
  },
): Promise<Campaign> {
  const selected = await selectCampaign(store, options, options.choose);
  if (selected && 'id' in selected) return loadCampaign(store, selected.id);
  const created = newCampaign(
    ulid(options.clock(), options.random),
    selected?.create ?? options.name ?? 'New campaign',
  );
  // Persist the initial scene before the campaign advertises its active ID.
  for (const scene of Object.values(created.scenes)) await store.saveScene(created.id, scene);
  await store.saveCampaign(created.id, CampaignFile.parse(created));
  return created;
}
