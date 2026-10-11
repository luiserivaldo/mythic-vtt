import { Campaign, reduceAction } from '@mythic/shared';
import { CampaignFile, StorageDataError, type Snapshot } from '../storage/types.js';
import type { LocalCampaignStore } from '../storage/local-campaign-store.js';

export interface RecoveredCampaign {
  campaign: Campaign;
  seq: number;
}

/** HIST-02: a single atomic snapshot is the checkpoint when split file writes were interrupted. */
export async function recoverCampaign(
  store: LocalCampaignStore,
  savedFiles: Campaign,
): Promise<RecoveredCampaign> {
  const sessions = await store.readSessions(savedFiles.id);
  if (sessions.length === 0) return { campaign: savedFiles, seq: 0 };
  const latest = sessions[sessions.length - 1];
  if (!latest) return { campaign: savedFiles, seq: 0 };
  const snapshots = await Promise.all(
    (['start', 'autosave', 'end'] as const).map((label) =>
      store.readSessionSnapshot(savedFiles.id, latest.sessionId, label),
    ),
  );
  const checkpoint = snapshots
    .filter((s): s is Snapshot => s !== undefined)
    .sort((a, b) => b.seq - a.seq)[0];
  if (!checkpoint) throw new StorageDataError('Session has no start snapshot', 'corrupt');
  let state = checkpoint.state;
  let seq = checkpoint.seq;
  for (const { envelope } of await store.readSessionLog(savedFiles.id, latest.sessionId)) {
    if (envelope.campaignId !== savedFiles.id || envelope.sessionId !== latest.sessionId)
      throw new StorageDataError('Log belongs to another campaign or session', 'corrupt');
    if (envelope.seq <= checkpoint.seq) continue;
    if (envelope.seq !== seq + 1)
      throw new StorageDataError(`Log sequence gap after ${String(seq)}`, 'corrupt');
    try {
      state = Campaign.parse(reduceAction(state, envelope).state);
    } catch (error) {
      throw new StorageDataError(
        `Cannot replay action ${String(envelope.seq)}: ${String(error)}`,
        'corrupt',
      );
    }
    seq = envelope.seq;
  }
  return { campaign: state, seq };
}

export async function saveCampaignCheckpoint(
  store: LocalCampaignStore,
  campaign: Campaign,
  sessionId: string,
  seq: number,
  label: 'autosave' | 'end',
): Promise<void> {
  // Write the authoritative checkpoint first. A crash during split writes can then recover
  // from this atomic snapshot and replay any later complete log entries.
  await store.writeSnapshot(campaign.id, sessionId, label, { seq, state: campaign });
  await store.saveCampaign(campaign.id, CampaignFile.parse(campaign));
  for (const scene of Object.values(campaign.scenes)) await store.saveScene(campaign.id, scene);
  await store.pruneScenes(campaign.id, new Set(Object.keys(campaign.scenes)));
}
