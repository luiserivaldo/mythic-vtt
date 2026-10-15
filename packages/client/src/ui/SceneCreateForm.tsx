import { useId, useState } from 'react';
import { BoundsFields } from './BoundsFields.js';
import { DEFAULT_BOUNDS_DRAFT, parseBoundsDraft } from './bounds-form.js';
import { isValidFolder, isValidSceneName } from './scene-list.js';

/** Name, folder and canvas size (D37, defaults shown) in one form so scene.create carries all. */
export function SceneCreateForm({
  folders,
  onSubmit,
}: {
  /** UI-SCN-01: folder names already in use, offered as suggestions. */
  folders: string[];
  onSubmit: (
    name: string,
    bounds: { width: number; height: number },
    folder: string,
  ) => Promise<boolean>;
}) {
  const [name, setName] = useState('');
  const [folder, setFolder] = useState('');
  const listId = useId();
  const [bounds, setBounds] = useState(DEFAULT_BOUNDS_DRAFT);
  const [busy, setBusy] = useState(false);
  const parsed = parseBoundsDraft(bounds);
  return (
    <form
      className="ui-row"
      onSubmit={(e) => {
        e.preventDefault();
        if (!parsed || !isValidSceneName(name) || !isValidFolder(folder)) return;
        setBusy(true);
        void onSubmit(name, parsed, folder.trim())
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
      <label>
        <span className="ui-visually-hidden">New scene folder</span>
        <input
          type="text"
          value={folder}
          placeholder="Folder (optional)"
          maxLength={64}
          list={listId}
          onChange={(e) => {
            setFolder(e.target.value);
          }}
        />
      </label>
      <datalist id={listId}>
        {folders.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
      <BoundsFields label="New scene" draft={bounds} onChange={setBounds} />
      <button type="submit" disabled={busy || !parsed || !isValidSceneName(name)}>
        Create scene
      </button>
    </form>
  );
}
