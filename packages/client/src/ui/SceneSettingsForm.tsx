import { useId, useState } from 'react';
import type { Scene } from '@mythic/shared';
import { BoundsFields } from './BoundsFields.js';
import { boundsDraftOf, parseBoundsDraft } from './bounds-form.js';
import { isValidFolder, isValidSceneName } from './scene-list.js';
import type { IntentSpec } from './intent-specs.js';
import { sceneSettingsIntents } from './scene-settings.js';

/**
 * UI-SCN-01: scene settings modelled on Roll20's page panel: name and folder, Canvas Size in
 * whole cells (D37) with the pixel size beside it, and Cell Size. "Canvas Size" avoids the word
 * "height" for the board's vertical extent, which means elevation in 3D (playtest F30).
 * The parent re-keys this form when the stored values change.
 */
export function SceneSettingsForm({
  scene,
  folders,
  send,
}: {
  scene: Scene;
  folders: string[];
  send: (intent: IntentSpec) => Promise<boolean>;
}) {
  const id = useId();
  const [name, setName] = useState(scene.name);
  const [folder, setFolder] = useState(scene.folder ?? '');
  const [bounds, setBounds] = useState(boundsDraftOf(scene));
  const [cell, setCell] = useState(String(scene.grid.sizePx));
  const parsed = parseBoundsDraft(bounds);
  const cellPx = /^\d+$/.test(cell.trim()) ? Number(cell) : NaN;
  const cellOk = cellPx >= 1 && cellPx <= 4096;
  const valid = parsed !== null && cellOk && isValidSceneName(name) && isValidFolder(folder);
  const intents = valid
    ? sceneSettingsIntents(scene, { name, folder, bounds: parsed, cellPx })
    : [];
  const px = (cells: number | undefined) =>
    cells !== undefined && cellOk ? `${String(cells * cellPx)} px` : '–';
  return (
    <form
      className="ui-scene-settings"
      aria-label={`Settings for ${scene.name}`}
      onSubmit={(e) => {
        e.preventDefault();
        void (async () => {
          for (const intent of intents) if (!(await send(intent))) return;
        })();
      }}
    >
      <label>
        Name{' '}
        <input
          type="text"
          value={name}
          maxLength={120}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
      </label>
      <label>
        Folder{' '}
        <input
          type="text"
          value={folder}
          maxLength={64}
          list={`${id}-folders`}
          placeholder="No folder"
          onChange={(e) => {
            setFolder(e.target.value);
          }}
        />
      </label>
      <datalist id={`${id}-folders`}>
        {folders.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
      <fieldset>
        <legend>Canvas Size</legend>
        <BoundsFields label={`Canvas of ${scene.name}`} draft={bounds} onChange={setBounds} />
        <output aria-label={`Canvas of ${scene.name} in pixels`}>
          {px(parsed?.width)} × {px(parsed?.height)}
        </output>
      </fieldset>
      <label>
        Cell Size (px){' '}
        <input
          type="number"
          min={1}
          max={4096}
          step={1}
          style={{ width: '5em' }}
          aria-invalid={!cellOk}
          value={cell}
          onChange={(e) => {
            setCell(e.target.value);
          }}
        />
      </label>
      <button type="submit" disabled={intents.length === 0}>
        Save settings
      </button>
    </form>
  );
}
