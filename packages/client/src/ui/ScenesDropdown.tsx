import { lazy, Suspense, useEffect } from 'react';
import { useStore } from 'zustand';
import { useClientStore } from '../store/react.js';
import { scenesViewStore } from '../store/viewed-campaign.js';

const ScenesView = lazy(async () => ({ default: (await import('./ScenesView.js')).ScenesView }));

/**
 * UI-SCN-01 (MV-247): the Scenes view expanded under the top bar's scene header. It lists the
 * authoritative campaign (every scene the DM may see), not the locally viewed one. Escape or the
 * header button closes it; closing never changes which scene is viewed (playtest F28).
 */
export function ScenesDropdown() {
  const open = useStore(scenesViewStore, (s) => s.open);
  const campaign = useClientStore((s) => s.campaign);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') scenesViewStore.getState().close();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  if (!open || !campaign) return null;
  return (
    <div className="ui-scenes-dropdown" id="ui-scenes-dropdown">
      <Suspense fallback={<p>Loading scenes…</p>}>
        <ScenesView campaign={campaign} />
      </Suspense>
    </div>
  );
}
