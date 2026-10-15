import { z } from 'zod';
import { Ulid } from './common.js';

const ImageHash = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * UX-05 / UI-HOST-02: one campaign on this host as the DM's campaign list shows it. Host-only
 * (`GET /api/campaigns`), strict, and only index metadata: no seats, scenes or identities.
 */
export const CampaignListEntry = z.strictObject({
  id: Ulid,
  name: z.string().max(200),
  /** Start of the newest session, ms since the epoch; absent if never opened. */
  lastPlayedAt: z.number().int().nonnegative().optional(),
  /** Image hash; fetch it from `GET /api/campaigns/:id/thumbnail` (any campaign on the host). */
  thumbnail: ImageHash.optional(),
});
export type CampaignListEntry = z.infer<typeof CampaignListEntry>;

/** Ordered by last played, newest first; never-played campaigns last, newest save first. */
export const CampaignList = z.strictObject({
  /** The campaign this host process has open. */
  current: Ulid,
  campaigns: z.array(CampaignListEntry).max(10_000),
});
export type CampaignList = z.infer<typeof CampaignList>;
