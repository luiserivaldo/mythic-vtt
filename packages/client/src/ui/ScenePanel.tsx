import { SceneOverlayForm } from './SceneOverlayForm.js';
import type { Campaign } from '@mythic/shared';
import { newId } from './ids.js';
import {
  sceneActivateIntent,
  sceneBoundsIntent,
  sceneCreateIntent,
  sceneRenameIntent,
} from './intent-specs.js';
import { NameForm } from './NameForm.js';
import { isValidSceneName, sceneRows } from './scene-list.js';
import { BackgroundForm } from './BackgroundForm.js';
import { backgroundDraft } from './background-form.js';
import { SceneBoundsForm } from './SceneBoundsForm.js';
import { SceneCreateForm } from './SceneCreateForm.js';
import { boundsDraft } from './bounds-form.js';
import { useSubmit } from './submit.js';

export function ScenePanel({ campaign }: { campaign: Campaign }) {
  const { send, error } = useSubmit();
  const rows = sceneRows(campaign);
  return (
    <section aria-labelledby="ui-scenes-h" className="ui-panel">
      <h2 id="ui-scenes-h">Scenes</h2>
      {rows.length === 0 && <p>No scenes yet. Create the first one.</p>}
      <ul className="ui-list">
        {rows.map((row) => (
          <li key={row.id}>
            <div className="ui-row">
              <strong>{row.name}</strong>
              {row.active ? (
                <span className="ui-badge">Active</span>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    void send(sceneActivateIntent(row.id));
                  }}
                >
                  Activate
                </button>
              )}
            </div>
            <NameForm
              label={`Rename ${row.name}`}
              submitLabel="Rename"
              initial={row.name}
              validate={(t) => isValidSceneName(t) && t.trim() !== row.name}
              onSubmit={(t) => send(sceneRenameIntent(row.id, t))}
            />
            {row.active && (
              <SceneBoundsForm
                key={`${row.id}:${JSON.stringify(boundsDraft(campaign, row.id))}`}
                name={row.name}
                initial={boundsDraft(campaign, row.id)}
                onSubmit={(b) => send(sceneBoundsIntent(row.id, b))}
              />
            )}
            {row.active && campaign.scenes[row.id] && (
              <SceneOverlayForm
                key={`${row.id}:${JSON.stringify(campaign.scenes[row.id]?.overlay)}`}
                scene={campaign.scenes[row.id] ?? null}
              />
            )}
            {row.active && (
              <BackgroundForm
                key={`${row.id}:${JSON.stringify(backgroundDraft(campaign, row.id))}`}
                sceneId={row.id}
                initial={backgroundDraft(campaign, row.id)}
                send={send}
              />
            )}
          </li>
        ))}
      </ul>
      <SceneCreateForm onSubmit={(t, b) => send(sceneCreateIntent(newId(), t, b))} />
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
