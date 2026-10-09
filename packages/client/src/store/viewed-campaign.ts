import type { Campaign } from '@mythic/shared';
import { useMemo } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { useClientStore } from './react.js';

/** UX-04: local browsing only; never serialized or written to the authoritative store. */
export const sceneBrowseStore = createStore<{ sceneId: string | null; browse(id: string): void }>()(
  (set) => ({
    sceneId: null,
    browse: (sceneId) => {
      set({ sceneId });
    },
  }),
);

export function viewedCampaign(
  campaign: Campaign | null,
  admin: boolean,
  sceneId: string | null,
): Campaign | null {
  if (
    !campaign ||
    !admin ||
    !sceneId ||
    !campaign.scenes[sceneId] ||
    sceneId === campaign.activeSceneId
  )
    return campaign;
  return { ...campaign, activeSceneId: sceneId };
}

export function useViewedCampaign(): Campaign | null {
  const campaign = useClientStore((s) => s.campaign);
  const isHost = useClientStore((s) => s.isHost);
  const seatId = useClientStore((s) => s.seatId);
  const sceneId = useStore(sceneBrowseStore, (s) => s.sceneId);
  const admin = isHost || (!!seatId && campaign?.seats[seatId]?.role === 'codm');
  return useMemo(() => viewedCampaign(campaign, admin, sceneId), [campaign, admin, sceneId]);
}
