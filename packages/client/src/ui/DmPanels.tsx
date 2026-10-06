import { useLayoutEffect, useRef, useState } from 'react';
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
  const shellRef = useRef<HTMLElement>(null);
  const [drawerTop, setDrawerTop] = useState(0);

  // The drawer is anchored just under the header (which wraps differently per viewport), so it
  // overlays the board instead of pushing it down in page flow.
  useLayoutEffect(() => {
    const measure = () => {
      const bottom = shellRef.current?.getBoundingClientRect().bottom ?? 0;
      setDrawerTop((prev) => (Math.abs(prev - bottom) < 0.5 ? prev : bottom));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
    };
  });

  if (!campaign) return null;
  const items = toolbarItems(viewerRole({ isHost, seatId, campaign }));
  if (items.length === 0) return null;
  // A panel the viewer lost access to (role change) must not stay open.
  const shown = items.some((i) => i.id === open) ? open : null;

  const title = items.find((i) => i.id === shown)?.label;
  const close = () => {
    setOpen(null);
  };

  return (
    <aside ref={shellRef} aria-label="DM tools" className="ui-shell" aria-busy={!ready}>
      <Toolbar
        items={items}
        open={shown}
        onToggle={(id) => {
          setOpen(shown === id ? null : id);
        }}
      />
      {shown && (
        <div
          className="ui-drawer"
          style={{ top: drawerTop }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close();
          }}
        >
          <div className="ui-drawer-head">
            <button type="button" onClick={close} aria-label={`Close ${title ?? 'panel'} panel`}>
              Close
            </button>
          </div>
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
        </div>
      )}
    </aside>
  );
}
