import { useId, useState, type ChangeEvent } from 'react';
import type { AssetRef } from '@mythic/shared';
import { sceneBackgroundIntent, sceneSkyboxIntent } from './intent-specs.js';
import { isValidBackgroundDraft, type BackgroundDraft } from './background-form.js';
import { resolveColor } from '../render/skybox-model.js';
import { UploadError, uploadFailureMessage, type ImageUploader } from '../assets/image-upload.js';
import { defaultUploader } from './default-uploader.js';

export function BackgroundForm({
  sceneId,
  initial,
  skybox,
  send,
  uploader = defaultUploader,
}: {
  sceneId: string;
  initial: BackgroundDraft;
  /** ENV-07: the current image skybox, if any. */
  skybox?: AssetRef | undefined;
  send: (intent: ReturnType<typeof sceneBackgroundIntent>) => Promise<boolean>;
  uploader?: ImageUploader;
}) {
  const [draft, setDraft] = useState(initial);
  const [gradient, setGradient] = useState(initial.zenith !== '');
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const skyboxInputId = useId();
  const value: BackgroundDraft = { ...draft, zenith: gradient ? draft.zenith || '#4a6fa5' : '' };

  async function onSkyboxFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    setBusy(true);
    setUploadError(null);
    try {
      const uploaded = await uploader(file);
      await send(
        sceneSkyboxIntent(sceneId, {
          source: 'local',
          hash: uploaded.hash,
          kind: 'image',
          name: file.name,
        }),
      );
    } catch (e) {
      setUploadError(
        e instanceof UploadError ? uploadFailureMessage(e) : 'The upload failed unexpectedly.',
      );
    } finally {
      setBusy(false);
      input.value = '';
    }
  }

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
      <div className="ui-row ui-file-field" role="group" aria-labelledby={`${skyboxInputId}-title`}>
        <span id={`${skyboxInputId}-title`}>Skybox image</span>
        <input
          id={skyboxInputId}
          className="ui-file-input"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={busy}
          aria-labelledby={`${skyboxInputId}-title ${skyboxInputId}-button`}
          onChange={(e) => {
            void onSkyboxFile(e);
          }}
        />
        <label id={`${skyboxInputId}-button`} className="ui-file-button" htmlFor={skyboxInputId}>
          Choose file
        </label>
        {skybox && (
          <button
            type="button"
            onClick={() => {
              void send(sceneSkyboxIntent(sceneId, null));
            }}
          >
            Clear skybox
          </button>
        )}
      </div>
      {uploadError && <p role="alert">{uploadError}</p>}
    </form>
  );
}
