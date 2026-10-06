import { useState } from 'react';
import { BoundsFields } from './BoundsFields.js';
import { DEFAULT_BOUNDS_DRAFT, parseBoundsDraft } from './bounds-form.js';
import { isValidSceneName } from './scene-list.js';

/** Name plus canvas size (D37, defaults shown) in one form so scene.create carries both. */
export function SceneCreateForm({
  onSubmit,
}: {
  onSubmit: (name: string, bounds: { width: number; height: number }) => Promise<boolean>;
}) {
  const [name, setName] = useState('');
  const [bounds, setBounds] = useState(DEFAULT_BOUNDS_DRAFT);
  const [busy, setBusy] = useState(false);
  const parsed = parseBoundsDraft(bounds);
  return (
    <form
      className="ui-row"
      onSubmit={(e) => {
        e.preventDefault();
        if (!parsed || !isValidSceneName(name)) return;
        setBusy(true);
        void onSubmit(name, parsed)
          .then((ok) => {
            if (ok) {
              setName('');
              setBounds(DEFAULT_BOUNDS_DRAFT);
            }
          })
          .finally(() => {
            setBusy(false);
          });
      }}
    >
      <label>
        <span className="ui-visually-hidden">New scene name</span>
        <input
          type="text"
          value={name}
          placeholder="New scene name"
          maxLength={120}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
      </label>
      <BoundsFields label="New scene" draft={bounds} onChange={setBounds} />
      <button type="submit" disabled={busy || !parsed || !isValidSceneName(name)}>
        Create scene
      </button>
    </form>
  );
}
