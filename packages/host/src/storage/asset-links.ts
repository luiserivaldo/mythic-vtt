import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LocalAssetStore } from './local-asset-store.js';
import type { LocalCampaignStore } from './local-campaign-store.js';

const BACKFILL_KEY = 'campaign-assets-backfill-v1';
const HASH = /[0-9a-f]{64}/g;

async function referencedHashes(store: LocalCampaignStore, id: string): Promise<Set<string>> {
  const folder = store.folder(id);
  const files = [join(folder, 'campaign.json')];
  for (const name of await readdir(join(folder, 'scenes')).catch(() => [] as string[]))
    if (name.endsWith('.json')) files.push(join(folder, 'scenes', name));
  const found = new Set<string>();
  for (const file of files) {
    const text = await readFile(file, 'utf8').catch(() => '');
    for (const match of text.matchAll(HASH)) found.add(match[0]);
  }
  return found;
}

/**
 * HOST-03 migration: data written before assets were scoped has no `campaign_assets` rows.
 * Each existing asset is linked to every campaign whose files reference its hash. An asset no
 * campaign references (uploaded, not yet placed) is linked to every existing campaign rather
 * than becoming unreachable. Runs once per data dir; nothing on disk is rewritten.
 */
export async function backfillAssetLinks(
  assets: LocalAssetStore,
  store: LocalCampaignStore,
): Promise<void> {
  if (assets.getMeta(BACKFILL_KEY) !== undefined) return;
  const hashes = assets.allHashes();
  const campaigns = await store.list();
  // Orphans can only be adopted once a campaign exists; stay un-flagged until then.
  if (hashes.length > 0 && campaigns.length === 0) return;
  const claimed = new Set<string>();
  const known = new Set(hashes);
  for (const { id } of campaigns) {
    for (const hash of await referencedHashes(store, id)) {
      if (!known.has(hash)) continue;
      assets.link(id, hash);
      claimed.add(hash);
    }
  }
  for (const hash of hashes)
    if (!claimed.has(hash)) for (const { id } of campaigns) assets.link(id, hash);
  assets.setMeta(BACKFILL_KEY, '1');
}
