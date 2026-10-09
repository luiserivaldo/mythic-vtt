import { useViewedCampaign } from '../store/viewed-campaign.js';
import type { Actor } from '@mythic/shared';
import { useMemo } from 'react';
import { useStore } from 'zustand';
import { useClientStore } from '../store/react.js';
import { selectionStore } from './selection-store.js';
import { resolveGizmo3DTarget, type Gizmo3DTarget } from './transform-gizmo-3d.js';

/** M2-08: the one selected prop/primitive/token this viewer may transform in 3D, or null. */
export function useGizmoTarget3D(): Gizmo3DTarget | null {
  const campaign = useViewedCampaign();
  const isHost = useClientStore((s) => s.isHost);
  const seatId = useClientStore((s) => s.seatId);
  const ids = useStore(selectionStore, (s) => s.ids);
  return useMemo(() => {
    const actor: Actor | null = isHost
      ? { kind: 'host' }
      : seatId !== null
        ? { kind: 'seat', seatId }
        : null;
    return resolveGizmo3DTarget(campaign, ids, actor);
  }, [campaign, ids, isHost, seatId]);
}
