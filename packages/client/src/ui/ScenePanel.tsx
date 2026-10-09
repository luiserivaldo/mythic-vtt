import { useState } from 'react';
import { useClientStore } from '../store/react.js';
import { sceneBrowseStore, useViewedCampaign } from '../store/viewed-campaign.js';
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
  const isHost = useClientStore((s) => s.isHost);
  const [dmOnly, setDmOnly] = useState(false);
  const { send, error } = useSubmit();
  const rows = sceneRows(campaign);
  const viewedId = useViewedCampaign()?.activeSceneId;
  return (
    <section aria-labelledby="ui-scenes-h" className="ui-panel">
      <h2 id="ui-scenes-h">Scenes</h2>
      {rows.length === 0 && <p>No scenes yet. Create the first one.</p>}
      <ul className="ui-list">
        {rows.map((row) => (
          <li key={row.id}>
            <div className="ui-row">
              <strong>{row.name}</strong>
              <button
                type="button"
                onClick={() => {
                  sceneBrowseStore.getState().browse(row.id);
                }}
              >
                Browse
              </button>
              {campaign.scenes[row.id]?.dmOnly && <span>DM-only</span>}
              <button
                type="button"
                disabled={!isHost || rows.length <= 1}
                onClick={() => {
                  void send({ type: 'scene.delete', payload: { sceneId: row.id } });
                }}
              >
                Delete
              </button>
              {row.active ? (
                <span className="ui-badge">Active</span>
              ) : (
                <button
                  type="button"
                  disabled={!isHost || campaign.scenes[row.id]?.dmOnly === true}
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
            {row.id === viewedId && (
              <SceneBoundsForm
                key={`${row.id}:${JSON.stringify(boundsDraft(campaign, row.id))}`}
                name={row.name}
                initial={boundsDraft(campaign, row.id)}
                onSubmit={(b) => send(sceneBoundsIntent(row.id, b))}
              />
            )}
            {row.id === viewedId && campaign.scenes[row.id] && (
              <SceneOverlayForm
                key={`${row.id}:${JSON.stringify(campaign.scenes[row.id]?.overlay)}`}
                scene={campaign.scenes[row.id] ?? null}
              />
            )}
            {row.id === viewedId && (
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
      <label>
        <input
          type="checkbox"
          checked={dmOnly}
          onChange={(e) => {
            setDmOnly(e.target.checked);
          }}
        />{' '}
        DM-only scene
      </label>
      <SceneCreateForm
        onSubmit={async (t, b) => {
          const id = newId();
          const intent = sceneCreateIntent(id, t, b);
          const ok = await send({
            ...intent,
            payload: { sceneId: id, name: t.trim(), bounds: b, dmOnly },
          });
          if (ok) sceneBrowseStore.getState().browse(id);
          return ok;
        }}
      />
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
