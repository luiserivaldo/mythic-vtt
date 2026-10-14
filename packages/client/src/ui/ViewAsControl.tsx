import { parseIdentityFile } from '../net/identity-file.js';
import { IDENTITY_STORAGE_KEY } from '../net/identity.js';
import { SpectatorViewResponse } from '@mythic/protocol';
import { audienceKey, type Audience, type LayerId } from '@mythic/shared';
import { useContext, useEffect, useRef, useState } from 'react';
import { useClientStore } from '../store/react.js';
import { selectionStore } from '../tools/selection-store.js';
import { aoeToolStore } from '../tools/aoe-tool-store.js';
import { rulerStore } from '../tools/ruler-store.js';
import { tokenDragStore } from '../tools/token-drag-store.js';
import { useJoinEnv } from './join-context.js';
import { UiStoreContext, useUiStore } from './ui-store.js';

/** UI-TOP-08: this escape hatch follows the real DM role, never the preview's role. */
export function ViewAsControl() {
  const realIsHost = useClientStore((s) => s.realIsHost);
  const campaign = useClientStore((s) => s.sourceCampaign);
  const viewAs = useClientStore((s) => s.viewAs);
  const setViewAs = useClientStore((s) => s.setViewAs);
  const setSpectatorSource = useClientStore((s) => s.setSpectatorSource);
  const pending = useClientStore((s) => s.pendingIntents);
  const ready = useClientStore((s) => s.ready);
  const select = useUiStore((s) => s.select);
  const uiStore = useContext(UiStoreContext);
  const stashedHidden = useRef<LayerId[]>([]);
  const env = useJoinEnv();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const key = audienceKey(viewAs);
  const preview = viewAs.kind !== 'host';

  useEffect(() => {
    // Discard local drafts and selections; they can refer to entities the new audience cannot see.
    selectionStore.getState().clear();
    select(null);
    aoeToolStore.getState().setActive(false);
    rulerStore.getState().clear();
    rulerStore.getState().pruneRemote(() => true);
    tokenDragStore.getState().setLocal(null);
    tokenDragStore.getState().pruneRemote(Infinity, 0);
  }, [key, select]);
  useEffect(() => {
    // A preview shows what the audience sees, so the DM's own hidden layers are set aside
    // and put back on return (local view state, never sent to the host).
    const ui = uiStore?.getState();
    if (!ui) return;
    if (preview) {
      const hidden = [...ui.hiddenLayers];
      if (hidden.length > 0) stashedHidden.current = hidden;
      for (const layer of hidden) ui.toggleLayerHidden(layer);
    } else {
      for (const layer of stashedHidden.current) ui.toggleLayerHidden(layer);
      stashedHidden.current = [];
    }
  }, [preview, uiStore]);
  useEffect(() => () => request.current?.abort(), []);

  async function choose(audience: Audience) {
    request.current?.abort();
    setLoading(false);
    setError('');
    if (audience.kind !== 'spectators') {
      setViewAs(audience);
      return;
    }
    // M4-02 keeps the spectator source outside the campaign. Resolve it before projecting.
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    try {
      const identity = parseIdentityFile(env?.storage.getItem(IDENTITY_STORAGE_KEY) ?? '');
      const response = await fetch('/api/spectator-view', {
        headers: { Authorization: `Mythic ${identity.identityId}.${identity.identitySecret}` },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('Spectator source unavailable');
      const source = SpectatorViewResponse.parse(await response.json());
      if (controller.signal.aborted) return;
      setSpectatorSource(source.seatId);
      setViewAs(audience);
    } catch {
      if (!controller.signal.aborted) setError('Could not load the spectator view. Try again.');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  if (!realIsHost) return null;
  const label = viewAs.kind === 'seat' ? campaign?.seats[viewAs.seatId]?.label : 'Spectator';
  return (
    <div className="ui-view-as">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
        }}
      >
        View as
      </button>
      {preview && (
        <>
          <span className="ui-view-as-chip">Viewing as {label} · Read only</span>
          <button
            type="button"
            onClick={() => {
              void choose({ kind: 'host' });
            }}
          >
            Back to DM
          </button>
        </>
      )}
      {open && (
        <div className="ui-view-as-menu" role="group" aria-label="View as options">
          <label>
            View as audience
            <select
              value={key}
              disabled={!ready || pending > 0 || loading}
              onChange={(event) => {
                const value = event.target.value;
                void choose(
                  value === 'host'
                    ? { kind: 'host' }
                    : value === 'spectators'
                      ? { kind: 'spectators' }
                      : { kind: 'seat', seatId: value.slice(5) },
                );
              }}
            >
              <option value="host">DM</option>
              {Object.values(campaign?.seats ?? {}).map((seat) => (
                <option key={seat.id} value={`seat:${seat.id}`}>
                  {seat.label} ({seat.role === 'codm' ? 'Co-DM' : 'Player'})
                </option>
              ))}
              <option value="spectators">Spectator</option>
            </select>
          </label>
          <label>
            How
            <select aria-label="View as mode" value="replace" onChange={() => undefined}>
              <option value="replace">Replace this view</option>
              <option value="new-tab" disabled>
                Open in new tab — Later
              </option>
            </select>
          </label>
          {loading && <p>Loading spectator view…</p>}
          {error && <p role="alert">{error}</p>}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
            }}
          >
            Close view options
          </button>
        </div>
      )}
    </div>
  );
}
