import { useState } from 'react';
import { BoundsFields } from './BoundsFields.js';
import { parseBoundsDraft, type BoundsDraft } from './bounds-form.js';

/** Edit the active scene's canvas size (D37). The parent re-keys it when the bounds change. */
export function SceneBoundsForm({
  name,
  initial,
  onSubmit,
}: {
  name: string;
  initial: BoundsDraft;
  onSubmit: (bounds: { width: number; height: number }) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(initial);
  const parsed = parseBoundsDraft(draft);
  const changed = draft.width.trim() !== initial.width || draft.height.trim() !== initial.height;
  return (
    <form
      className="ui-row"
      onSubmit={(e) => {
        e.preventDefault();
        if (parsed) void onSubmit(parsed);
      }}
    >
      <BoundsFields label={`Canvas of ${name}`} draft={draft} onChange={setDraft} />
      <button type="submit" disabled={!parsed || !changed}>
        Set size
      </button>
    </form>
  );
}
