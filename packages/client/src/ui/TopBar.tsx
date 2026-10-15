import { useStore } from 'zustand';
import { ViewAsControl } from './ViewAsControl.js';
import { useClientStore } from '../store/react.js';
import { useViewedCampaign } from '../store/viewed-campaign.js';
import { cameraLinkStore } from '../render/camera-link-store.js';
import { ViewToggle } from '../render/ViewToggle.js';
import { viewModeStore } from '../render/view-mode-store.js';
import { dockStore } from './dock-store.js';
import { IdentityStatus } from './IdentityStatus.js';
import { InviteButton } from './InvitePopover.js';
import { SeatAvatars } from './SeatAvatars.js';
import { isAdminRole, viewerRole } from './viewer.js';

export function TopBar() {
  const campaign = useViewedCampaign();
  const isHost = useClientStore((state) => state.isHost);
  const seatId = useClientStore((state) => state.seatId);
  const role = viewerRole({ campaign, isHost, seatId });
  const admin = isAdminRole(role);
  // CAM-06: only a spectator follows the DM camera, and only while it chooses to.
  const following = useStore(cameraLinkStore, (state) => state.following);
  // PERM-03: use only the host-filtered scene; an empty player scene has an empty label.
  const name = campaign?.activeSceneId ? (campaign.scenes[campaign.activeSceneId]?.name ?? '') : '';
  return (
    <header className="ui-top-bar">
      {admin ? (
        <button
          type="button"
          className="ui-scene-heading"
          aria-label="Open scene picker"
          onClick={() => {
            dockStore.getState().open('scenes');
          }}
        >
          {name}
        </button>
      ) : (
        <span className="ui-scene-heading" aria-label="Scene name">
          {name}
        </span>
      )}
      <ViewToggle />
      <button
        type="button"
        onClick={() => {
          viewModeStore.getState().reset();
        }}
      >
        Reset view
      </button>
      <ViewAsControl />
      <SeatAvatars />
      <IdentityStatus />
      <InviteButton />
      {/* CAM-06: the DM takes everyone watching players to their own camera. */}
      {admin && (
        <button
          type="button"
          onClick={() => {
            cameraLinkStore.getState().requestPull();
          }}
        >
          Pull players to my view
        </button>
      )}
      {role === 'observer' && (
        <button
          type="button"
          aria-pressed={following}
          onClick={() => {
            cameraLinkStore.getState().setFollowing(!following);
          }}
        >
          Follow the DM camera
        </button>
      )}
    </header>
  );
}
