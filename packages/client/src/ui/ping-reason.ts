import { canPing } from '../tools/ping.js';
import { useClientStore } from '../store/react.js';
import { useViewedCampaign } from '../store/viewed-campaign.js';
import { INTERACTION_OFF_REASON, READ_ONLY_REASON, SPECTATOR_REASON } from './tool-rail.js';
import { isReadOnlyViewer, viewerRole } from './viewer.js';

/**
 * UX-40: why this viewer cannot ping right now, or `undefined` when they can. Ping lives in the
 * board and token right-click menus; like every board tool it is shown disabled with a reason
 * rather than hidden (UI-TOOL-07), and the host re-checks the scene's `pins` toggle (PERM-05).
 */
export function usePingReason(): string | undefined {
  const campaign = useClientStore((s) => s.campaign);
  const isHost = useClientStore((s) => s.isHost);
  const seatId = useClientStore((s) => s.seatId);
  const preview = useClientStore((s) => s.viewAs.kind !== 'host');
  const viewed = useViewedCampaign();
  const sceneId = viewed?.activeSceneId ?? null;
  const role = viewerRole({ isHost, seatId, campaign });
  const readOnly = preview || isReadOnlyViewer({ isHost, seatId, campaign });
  const seat = seatId === null ? undefined : campaign?.seats[seatId];
  const interactionEnabled = isHost || seat === undefined || seat.interactionEnabled !== false;

  if (!sceneId) return 'There is no active scene';
  if (readOnly) return role === 'observer' ? SPECTATOR_REASON : READ_ONLY_REASON;
  if (!interactionEnabled) return INTERACTION_OFF_REASON;
  if (!canPing(viewed, { isHost, seatId }, sceneId)) return 'Pinging is off in this scene';
  return undefined;
}
