import type { Campaign } from '@mythic/shared';
import { useMemo } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { useClientStore } from './react.js';

/** UX-04: local browsing only; never serialized or written to the authoritative store. */
export const sceneBrowseStore = createStore<{
  sceneId: string | null;
  browse(id: string): void;
  /** Back to the active scene (playtest F28: leaving a viewed scene must be undoable). */
  reset(): void;
}>()((set) => ({
  sceneId: null,
  browse: (sceneId) => {
    set({ sceneId });
  },
  reset: () => {
    set({ sceneId: null });
  },
}));

/** UI-SCN-01: whether the Scenes view is expanded under the top bar's scene header. Local. */
export const scenesViewStore = createStore<{ open: boolean; toggle(): void; close(): void }>()(
  (set) => ({
    open: false,
    toggle: () => {
      set((s) => ({ open: !s.open }));
    },
    close: () => {
      set({ open: false });
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
  const browsing = useStore(sceneBrowseStore, (s) => s.sceneId);
  const preview = useClientStore((s) => s.viewAs.kind !== 'host');
  const sceneId = preview ? null : browsing;
  const admin = isHost || (!!seatId && campaign?.seats[seatId]?.role === 'codm');
  return useMemo(() => viewedCampaign(campaign, admin, sceneId), [campaign, admin, sceneId]);
}
