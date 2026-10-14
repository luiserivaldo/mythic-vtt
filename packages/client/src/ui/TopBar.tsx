import { ViewAsControl } from './ViewAsControl.js';
import { useClientStore } from '../store/react.js';
import { useViewedCampaign } from '../store/viewed-campaign.js';
import { ViewToggle } from '../render/ViewToggle.js';
import { viewModeStore } from '../render/view-mode-store.js';
import { dockStore } from './dock-store.js';
import { IdentityStatus } from './IdentityStatus.js';
import { isAdminRole, viewerRole } from './viewer.js';

export function TopBar() {
  const campaign = useViewedCampaign();
  const isHost = useClientStore((state) => state.isHost);
  const seatId = useClientStore((state) => state.seatId);
  const admin = isAdminRole(viewerRole({ campaign, isHost, seatId }));
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
      <IdentityStatus />
    </header>
  );
}
