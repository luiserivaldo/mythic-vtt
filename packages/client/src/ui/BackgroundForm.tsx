import { useState } from 'react';
import { sceneBackgroundIntent } from './intent-specs.js';
import { isValidBackgroundDraft, type BackgroundDraft } from './background-form.js';
import { resolveColor } from '../render/skybox-model.js';

export function BackgroundForm({
  sceneId,
  initial,
  send,
}: {
  sceneId: string;
  initial: BackgroundDraft;
  send: (intent: ReturnType<typeof sceneBackgroundIntent>) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(initial);
  const [gradient, setGradient] = useState(initial.zenith !== '');
  const value: BackgroundDraft = { ...draft, zenith: gradient ? draft.zenith || '#4a6fa5' : '' };
  return (
    <form
      className="ui-row"
      onSubmit={(e) => {
        e.preventDefault();
        void send(
          sceneBackgroundIntent(
            sceneId,
            resolveColor(value.background),
            value.zenith ? resolveColor(value.zenith) : null,
          ),
        );
      }}
    >
      <label>
        Background (horizon){' '}
        <input
          type="color"
          value={resolveColor(draft.background)}
          onChange={(e) => {
            setDraft({ ...draft, background: e.target.value });
          }}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={gradient}
          onChange={(e) => {
            setGradient(e.target.checked);
          }}
        />{' '}
        3D gradient
      </label>
      {gradient && (
        <label>
          Zenith{' '}
          <input
            type="color"
            value={resolveColor(value.zenith)}
            onChange={(e) => {
              setDraft({ ...draft, zenith: e.target.value });
            }}
          />
        </label>
      )}
      <button type="submit" disabled={!isValidBackgroundDraft(value)}>
        Set background
      </button>
    </form>
  );
}
