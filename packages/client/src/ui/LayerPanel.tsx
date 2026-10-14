import type { Campaign } from '@mythic/shared';
import { layerLockIntent, entityMoveLayerIntent } from './intent-specs.js';
import { layerRows, moveTargets } from './layer-panel.js';
import { useSubmit } from './submit.js';
import { useUiStore } from './ui-store.js';
import type { ViewerRole } from './viewer.js';

export function LayerPanel({ campaign, role }: { campaign: Campaign; role: ViewerRole }) {
  const { send, error } = useSubmit();
  const hidden = useUiStore((s) => s.hiddenLayers);
  const toggleHidden = useUiStore((s) => s.toggleLayerHidden);
  const activeLayer = useUiStore((s) => s.activeLayer);
  const setActiveLayer = useUiStore((s) => s.setActiveLayer);
  const selectedId = useUiStore((s) => s.selectedEntityId);
  const scene = campaign.activeSceneId ? campaign.scenes[campaign.activeSceneId] : undefined;
  if (!scene) {
    return (
      <section aria-labelledby="ui-layers-h" className="ui-panel">
        <h2 id="ui-layers-h">Layers</h2>
        <p>No active scene.</p>
      </section>
    );
  }
  const selected = selectedId ? scene.entities[selectedId] : undefined;
  return (
    <section aria-labelledby="ui-layers-h" className="ui-panel">
      <h2 id="ui-layers-h">Layers</h2>
      <ul className="ui-list" aria-label="Layers, top row drawn above the rows beneath it">
        {layerRows(scene, hidden, { role, activeLayer }).map((row) => (
          <li key={row.layer} className="ui-row">
            <button
              type="button"
              aria-pressed={row.active}
              title={`Draw new entities on ${row.label}`}
              onClick={() => {
                setActiveLayer(row.layer);
              }}
            >
              <strong>{row.label}</strong>
              {row.description && <> — {row.description}</>}
            </button>
            <label>
              <input
                type="checkbox"
                checked={!row.hidden}
                aria-label={`Show ${row.label}`}
                onChange={() => {
                  toggleHidden(row.layer);
                }}
              />{' '}
              Visible
            </label>
            <label>
              <input
                type="checkbox"
                checked={row.locked}
                disabled={row.lockDisabledReason !== null}
                aria-label={`Lock ${row.label}`}
                title={row.lockDisabledReason ?? `Lock ${row.label} against editing`}
                onChange={(e) => {
                  void send(layerLockIntent(scene.id, row.layer, e.target.checked));
                }}
              />{' '}
              Locked
            </label>
            {row.lockDisabledReason && <span>{row.lockDisabledReason}</span>}
          </li>
        ))}
      </ul>
      <h3>Selected entity</h3>
      {selected ? (
        <div
          className="ui-row"
          role="group"
          aria-label={`Move selected entity from ${selected.layer}`}
        >
          <span>On layer: {selected.layer}</span>
          {moveTargets(scene, selected).map((t) => (
            <button
              key={t.layer}
              type="button"
              disabled={t.disabledReason !== null}
              title={t.disabledReason ?? undefined}
              onClick={() => {
                void send(entityMoveLayerIntent(scene.id, selected.id, t.layer));
              }}
            >
              Move to {t.label}
            </button>
          ))}
        </div>
      ) : (
        <p>Select an entity on the board to move it between layers.</p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
