import { canPing } from '../tools/ping.js';
import { pingStore } from '../tools/ping-store.js';
import { useViewedCampaign } from '../store/viewed-campaign.js';
import { useClientStore } from '../store/react.js';
import { INTERACTION_OFF_REASON, READ_ONLY_REASON, SPECTATOR_REASON } from './tool-rail.js';
import { isReadOnlyViewer, viewerRole } from './viewer.js';

/**
 * LAY-05: a Ping button on the board controls, for a viewer who does not know the alt-click
 * gesture. It marks the centre of the view (the same point in 2D and in 3D) for everyone at the
 * table; nothing is stored. Like every board tool it stays visible and is disabled with a reason
 * rather than hidden (UI-TOOL-07), and the host re-checks the scene's `pins` toggle (PERM-05).
 */
export function PingButton() {
  const campaign = useClientStore((s) => s.campaign);
  const isHost = useClientStore((s) => s.isHost);
  const seatId = useClientStore((s) => s.seatId);
  const viewed = useViewedCampaign();
  const sceneId = viewed?.activeSceneId ?? null;
  const role = viewerRole({ isHost, seatId, campaign });
  const readOnly = isReadOnlyViewer({ isHost, seatId, campaign });
  const seat = seatId === null ? undefined : campaign?.seats[seatId];
  const interactionEnabled = isHost || seat === undefined || seat.interactionEnabled !== false;

  let reason: string | undefined;
  if (!sceneId) reason = 'There is no active scene';
  else if (readOnly) reason = role === 'observer' ? SPECTATOR_REASON : READ_ONLY_REASON;
  else if (!interactionEnabled) reason = INTERACTION_OFF_REASON;
  else if (!canPing(viewed, { isHost, seatId }, sceneId)) reason = 'Pinging is off in this scene';

  return (
    <>
      <button
        type="button"
        className="ui-rail-tool"
        aria-disabled={reason === undefined ? undefined : true}
        aria-describedby={reason === undefined ? undefined : 'ping-reason'}
        title={reason ?? 'Ping the centre of the view (or Alt-click the board)'}
        onClick={() => {
          if (reason === undefined) pingStore.getState().requestCentre();
        }}
      >
        <span aria-hidden="true" className="ui-rail-glyph">
          ◎
        </span>
        Ping
      </button>
      {reason !== undefined && (
        <span id="ping-reason" className="ui-visually-hidden">
          {reason}
        </span>
      )}
    </>
  );
}
