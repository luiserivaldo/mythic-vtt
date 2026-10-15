import { resolvePlayerToggles } from '@mythic/shared';
import { useId, useState } from 'react';
import { useClientStore } from '../store/react.js';
import { useViewedCampaign } from '../store/viewed-campaign.js';
import { IDENTITY_STORAGE_KEY } from '../net/identity.js';
import { parseIdentityFile } from '../net/identity-file.js';
import { CampaignThumbnailControls } from './CampaignThumbnailControls.js';
import { useJoinEnv } from './join-context.js';
import { useSubmit } from './submit.js';
import { isAdminRole, viewerRole } from './viewer.js';
import { useViewerPreferences } from './ViewerPreferencesProvider.js';
import type { DockTheme } from './RightDock.js';

export function SettingsPanel({
  theme,
  onThemeChange,
}: {
  theme: DockTheme;
  onThemeChange: (theme: DockTheme) => void;
}) {
  const { preferences, update } = useViewerPreferences();
  const campaign = useClientStore((s) => s.campaign);
  const viewed = useViewedCampaign();
  const isHost = useClientStore((s) => s.isHost);
  const seatId = useClientStore((s) => s.seatId);
  const ready = useClientStore((s) => s.ready);
  const admin = isAdminRole(viewerRole({ campaign, isHost, seatId }));
  const scene = viewed?.activeSceneId ? viewed.scenes[viewed.activeSceneId] : undefined;
  const env = useJoinEnv();
  const { send, error } = useSubmit();
  const [pendingMeasure, setPendingMeasure] = useState<boolean | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const createHint = useId();
  const mayChangePermissions =
    ready && (isHost || (seatId !== null && campaign?.seats[seatId]?.interactionEnabled !== false));

  async function changeMeasure(measure: boolean) {
    if (!scene || pendingMeasure !== null) return;
    setPendingMeasure(measure);
    try {
      await send({
        type: 'scene.setPlayerToggles',
        sceneId: scene.id,
        payload: { sceneId: scene.id, toggles: { measure } },
      });
    } finally {
      setPendingMeasure(null);
    }
  }

  async function exportCampaign() {
    if (!isHost || !campaign || !env || exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const identity = parseIdentityFile(env.storage.getItem(IDENTITY_STORAGE_KEY) ?? '');
      const response = await fetch(`/api/campaigns/${encodeURIComponent(campaign.id)}/export`, {
        headers: { Authorization: `Mythic ${identity.identityId}.${identity.identitySecret}` },
      });
      if (!response.ok) throw new Error('export denied');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `campaign-${campaign.id}.zip`;
      link.click();
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 1000);
    } catch {
      setExportError('Could not export the campaign. Try again.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="ui-panel" aria-label="Viewer settings">
      <fieldset className="ui-dock-settings">
        <legend>Appearance</legend>
        {(['dark', 'light'] as const).map((value) => (
          <label key={value}>
            <input
              type="radio"
              name="theme"
              checked={theme === value}
              onChange={() => {
                onThemeChange(value);
              }}
            />
            {value === 'dark' ? 'Dark' : 'Light'}
          </label>
        ))}
        <label>
          <input
            type="checkbox"
            checked={preferences.showHeightLabels}
            onChange={(e) => {
              update({ showHeightLabels: e.target.checked });
            }}
          />{' '}
          Show height labels
        </label>
      </fieldset>
      <label>
        <input
          type="checkbox"
          checked={preferences.confirmBeforeDeleting}
          onChange={(e) => {
            update({ confirmBeforeDeleting: e.target.checked });
          }}
        />{' '}
        Confirm before deleting
      </label>
      {admin && (
        <fieldset>
          <legend>Table settings</legend>
          {scene ? (
            <>
              <p>Player permissions in {scene.name}</p>
              <label>
                <input
                  type="checkbox"
                  checked={pendingMeasure ?? resolvePlayerToggles(scene).measure}
                  disabled={!mayChangePermissions || pendingMeasure !== null}
                  onChange={(e) => {
                    void changeMeasure(e.target.checked);
                  }}
                />{' '}
                Players may measure
              </label>
            </>
          ) : (
            <p>No scene selected.</p>
          )}
          <label>
            <input type="checkbox" disabled aria-describedby={createHint} /> Players may create
          </label>
          <p id={createHint}>DM and Co-DM only</p>
          <button
            type="button"
            disabled={!isHost || !ready || exporting}
            title={isHost ? undefined : 'Only the host DM can export campaigns'}
            onClick={() => {
              void exportCampaign();
            }}
          >
            {exporting ? 'Exporting…' : 'Export campaign'}
          </button>
          {error && <p role="alert">{error}</p>}
          {exportError && <p role="alert">{exportError}</p>}
        </fieldset>
      )}
      {/* UX-05: renders only for the host DM. */}
      <CampaignThumbnailControls />
      <button type="button" disabled title="Game log is a work in progress">
        Game log (WIP)
      </button>
    </section>
  );
}
