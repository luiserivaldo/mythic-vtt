import type { Campaign } from '@mythic/shared';
import { newId } from './ids.js';
import { sceneActivateIntent, sceneCreateIntent, sceneRenameIntent } from './intent-specs.js';
import { NameForm } from './NameForm.js';
import { isValidSceneName, sceneRows } from './scene-list.js';
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
          </li>
        ))}
      </ul>
      <NameForm
        label="New scene name"
        submitLabel="Create scene"
        validate={isValidSceneName}
        onSubmit={(t) => send(sceneCreateIntent(newId(), t))}
      />
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
