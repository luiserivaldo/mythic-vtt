import type { Campaign } from '@mythic/shared';
import { layerLockIntent, entityMoveLayerIntent } from './intent-specs.js';
import { layerRows, moveTargets } from './layer-panel.js';
import { useSubmit } from './submit.js';
import { useUiStore } from './ui-store.js';

export function LayerPanel({ campaign }: { campaign: Campaign }) {
  const { send, error } = useSubmit();
  const hidden = useUiStore((s) => s.hiddenLayers);
  const toggleHidden = useUiStore((s) => s.toggleLayerHidden);
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
      <ul className="ui-list">
        {layerRows(scene, hidden).map((row) => (
          <li key={row.layer} className="ui-row">
            <span>{row.label}</span>
            <label>
              <input
                type="checkbox"
                checked={row.locked}
                onChange={(e) => {
                  void send(layerLockIntent(scene.id, row.layer, e.target.checked));
                }}
              />{' '}
              Locked
            </label>
            <label>
              <input
                type="checkbox"
                checked={row.hidden}
                onChange={() => {
                  toggleHidden(row.layer);
                }}
              />{' '}
              Hidden (this screen only)
            </label>
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
