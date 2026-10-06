import type { Actor } from '@mythic/shared';
import { useMemo } from 'react';
import { useStore } from 'zustand';
import { useClientStore } from '../store/react.js';
import { selectionStore } from './selection-store.js';
import { resolveGizmoTarget, type GizmoTarget } from './transform-gizmo.js';

/**
 * The single selected entity this viewer may transform, or null. Selectors return primitives or
 * store-owned references only: a fresh object per read would loop React forever.
 */
export function useGizmoTarget(): GizmoTarget | null {
  const campaign = useClientStore((s) => s.campaign);
  const isHost = useClientStore((s) => s.isHost);
  const seatId = useClientStore((s) => s.seatId);
  const ids = useStore(selectionStore, (s) => s.ids);
  return useMemo(() => {
    const actor: Actor | null = isHost
      ? { kind: 'host' }
      : seatId !== null
        ? { kind: 'seat', seatId }
        : null;
    return resolveGizmoTarget(campaign, ids, actor);
  }, [campaign, ids, isHost, seatId]);
}
