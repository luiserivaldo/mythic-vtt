import { useMemo } from 'react';
import { useStore } from 'zustand';
import { canUseTool, type Actor } from '@mythic/shared';
import { useClientStore } from '../store/react.js';
import { useViewedCampaign } from '../store/viewed-campaign.js';
import { activeToolStore } from '../tools/active-tool-store.js';
import { aoeToolStore } from '../tools/aoe-tool-store.js';
import { rulerStore } from '../tools/ruler-store.js';
import {
  railToolStates,
  resolveActiveTool,
  SEAT_TOOL_OFF_REASON,
  type RailToolState,
} from './tool-rail.js';
import { isReadOnlyViewer, viewerRole } from './viewer.js';

export interface RailTools {
  /** Every rail tool, enabled or disabled with a reason (UI-TOOL-07). */
  states: RailToolState[];
  /** The tool in effect: Measure while a ruler or AoE is armed, else the requested usable tool. */
  activeId: string;
  measuring: boolean;
}

/**
 * UI-TOOL-01..07: the rail's state, shared by the rail and the board. The board needs the tool in
 * effect (not merely the one requested) because a viewer who cannot select falls back to Pan, and
 * only Pan lets a left drag move the camera (UI-INPUT-01).
 */
export function useRailTools(): RailTools {
  const store = useClientStore((state) => state.campaign);
  const viewed = useViewedCampaign();
  const isHost = useClientStore((state) => state.isHost);
  const seatId = useClientStore((state) => state.seatId);
  const requested = useStore(activeToolStore, (state) => state.tool);
  const rulerArmed = useStore(rulerStore, (state) => state.tool);
  const aoeActive = useStore(aoeToolStore, (state) => state.active);
  const measuring = rulerArmed || aoeActive;

  const role = viewerRole({ isHost, seatId, campaign: store });
  const preview = useClientStore((state) => state.viewAs.kind !== 'host');
  const readOnly = preview || isReadOnlyViewer({ isHost, seatId, campaign: store });
  const seat = seatId === null ? undefined : store?.seats[seatId];
  const permissions = seat?.permissions ?? null;
  // Enable Interaction is a per-seat switch; the host and seat-less viewers are never switched off.
  const interactionEnabled = isHost || seat === undefined || seat.interactionEnabled !== false;

  // UI-SEAT-02 (UX-46): the seat's own tools apply to seats the registry would allow.
  const toolReasons = useMemo<Record<string, string | undefined>>(() => {
    const sceneId = viewed?.activeSceneId;
    if (!viewed || !sceneId || isHost) return {};
    const actor: Actor = seatId !== null ? { kind: 'seat', seatId } : { kind: 'seat' };
    return {
      measure: canUseTool(viewed, actor, sceneId, 'measure')
        ? undefined
        : SEAT_TOOL_OFF_REASON.measure,
      draw: canUseTool(viewed, actor, sceneId, 'draw') ? undefined : SEAT_TOOL_OFF_REASON.draw,
    };
  }, [viewed, isHost, seatId]);

  const states = useMemo(
    () =>
      railToolStates({
        role,
        permissions,
        readOnly,
        interactionEnabled,
        toolReasons,
      }),
    [role, permissions, readOnly, interactionEnabled, toolReasons],
  );
  const activeId = measuring ? 'measure' : resolveActiveTool(states, requested);
  return { states, activeId, measuring };
}
