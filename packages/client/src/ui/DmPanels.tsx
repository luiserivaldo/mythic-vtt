import { useState } from 'react';
import { useClientStore } from '../store/react.js';
import { EntityPanel } from './EntityPanel.js';
import { LayerPanel } from './LayerPanel.js';
import { MapPanel } from './MapPanel.js';
import { ScenePanel } from './ScenePanel.js';
import { SeatPanel } from './SeatPanel.js';
import { Toolbar } from './Toolbar.js';
import { toolbarItems, type PanelId } from './toolbar-items.js';
import { viewerRole } from './viewer.js';

/** Toolbar plus the DM panels. Renders nothing for players and observers (D24, PERM-02). */
export function DmPanels() {
  const campaign = useClientStore((s) => s.campaign);
  const ready = useClientStore((s) => s.ready);
  const isHost = useClientStore((s) => s.isHost);
  const seatId = useClientStore((s) => s.seatId);
  const presence = useClientStore((s) => s.presence);
  const [open, setOpen] = useState<PanelId | null>(null);

  if (!campaign) return null;
  const items = toolbarItems(viewerRole({ isHost, seatId, campaign }));
  if (items.length === 0) return null;
  // A panel the viewer lost access to (role change) must not stay open.
  const shown = items.some((i) => i.id === open) ? open : null;

  return (
    <aside aria-label="DM tools" className="ui-shell" aria-busy={!ready}>
      <Toolbar
        items={items}
        open={shown}
        onToggle={(id) => {
          setOpen(shown === id ? null : id);
        }}
      />
      {shown === 'scenes' && <ScenePanel campaign={campaign} />}
      {shown === 'layers' && <LayerPanel campaign={campaign} />}
      {shown === 'map' && <MapPanel campaign={campaign} />}
      {shown === 'entities' && <EntityPanel campaign={campaign} />}
      {shown === 'seats' && (
        <SeatPanel
          campaign={campaign}
          presence={presence?.seats ?? null}
          unseated={presence?.unseated}
        />
      )}
    </aside>
  );
}
