import { z } from 'zod';
import { ActionEnvelope, Campaign, Id, Scene } from '@mythic/shared';
import type { Patch } from 'immer';
import type { Readable } from 'node:stream';

export { CURRENT_SCHEMA_VERSION } from '@mythic/shared';
export const CampaignFile = Campaign.omit({ scenes: true });
export type CampaignFile = z.infer<typeof CampaignFile>;
export const Snapshot = z.object({
  seq: z.number().int().nonnegative(),
  round: z.number().int().nonnegative().optional(),
  state: Campaign,
});
export type Snapshot = z.infer<typeof Snapshot>;
export const PatchSchema = z.object({
  op: z.enum(['add', 'replace', 'remove']),
  path: z.array(z.union([z.string(), z.number()])),
  value: z.unknown().optional(),
});
export const LogEntry = z.object({
  envelope: ActionEnvelope,
  inversePatches: z.array(PatchSchema),
});
export type LogEntry = { envelope: ActionEnvelope; inversePatches: Patch[] };
export type LoadedCampaign = { campaign: CampaignFile; scenes: Scene[] };
export type CampaignMeta = { id: string; name: string; schemaVersion: number; updatedAt: number };
export const AssetMeta = z.object({
  mime: z.string().min(1),
  size: z.number().int().nonnegative(),
  ext: z.string().regex(/^[a-z0-9]+$/),
});
export type AssetMeta = z.infer<typeof AssetMeta>;

export type Migration = (
  kind: 'campaign' | 'scene' | 'snapshot' | 'session',
  version: number,
  payload: unknown,
) => unknown;
export class StorageDataError extends Error {
  constructor(
    message: string,
    public readonly code: 'corrupt' | 'unsupported-version' | 'not-found',
  ) {
    super(message);
  }
}
export interface CampaignStore {
  list(): Promise<CampaignMeta[]>;
  load(campaignId: Id): Promise<LoadedCampaign>;
  saveScene(campaignId: Id, scene: Scene): Promise<void>;
  saveCampaign(campaignId: Id, campaign: CampaignFile): Promise<void>;
  appendLog(campaignId: Id, sessionId: Id, entries: LogEntry[]): Promise<void>;
  writeSnapshot(campaignId: Id, sessionId: Id, label: string, snapshot: Snapshot): Promise<void>;
  export(campaignId: Id): Promise<Readable>;
}
export interface AssetStore {
  has(hash: string): Promise<boolean>;
  put(hash: string, data: Readable, meta: AssetMeta): Promise<void>;
  get(hash: string): Promise<Readable>;
  publicUrl?(hash: string): Promise<string | null>;
}
