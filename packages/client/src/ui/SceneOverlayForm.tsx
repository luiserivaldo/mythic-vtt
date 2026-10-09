import { useState } from 'react';
import { SceneOverlay, type Scene } from '@mythic/shared';
import { useSubmit } from './submit.js';

export function SceneOverlayForm({ scene }: { scene: Scene | null }) {
  return scene ? <OverlayForm scene={scene} /> : null;
}
function OverlayForm({ scene }: { scene: Scene }) {
  const { send, error } = useSubmit();
  const [draft, setDraft] = useState(
    scene.overlay ?? { tint: '#ffffff', tintOpacity: 0, darkness: 0 },
  );
  const submit = (overlay: SceneOverlay | null) =>
    send({ type: 'scene.setOverlay', sceneId: scene.id, payload: { sceneId: scene.id, overlay } });
  return (
    <fieldset>
      <legend>Scene filters</legend>
      <p>Translucent washes keep the board visible; labels stay clear in both views.</p>
      <label>
        Tint{' '}
        <input
          type="color"
          value={draft.tint}
          onChange={(e) => {
            setDraft({ ...draft, tint: e.target.value });
          }}
        />
      </label>
      <label>
        Tint strength{' '}
        <input
          type="number"
          min="0"
          max="0.35"
          step="0.05"
          value={draft.tintOpacity}
          onChange={(e) => {
            setDraft({ ...draft, tintOpacity: Number(e.target.value) });
          }}
        />
      </label>
      <label>
        Darkness{' '}
        <input
          type="number"
          min="0"
          max="0.5"
          step="0.05"
          value={draft.darkness}
          onChange={(e) => {
            setDraft({ ...draft, darkness: Number(e.target.value) });
          }}
        />
      </label>
      <button
        type="button"
        disabled={!SceneOverlay.safeParse(draft).success}
        onClick={() => {
          void submit(draft);
        }}
      >
        Apply filters
      </button>
      <button
        type="button"
        onClick={() => {
          void submit(null);
        }}
      >
        Clear filters
      </button>
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
