import { campaignThumbnail } from '@mythic/shared';
import { useState } from 'react';
import { UploadError, uploadFailureMessage } from '../assets/image-upload.js';
import { useClientStore } from '../store/react.js';
import { brandingIntent, THUMBNAIL_TYPES } from './campaign-thumbnail.js';
import { defaultUploader } from './default-uploader.js';
import './join-screen.css';
import { useSubmit } from './submit.js';

/**
 * UI-HOST-02 (UX-05), host DM only: the campaign list thumbnail (an upload, else the board as
 * spectators see it, captured on End Game; see GameExit).
 */
export function CampaignThumbnailControls() {
  const realIsHost = useClientStore((s) => s.realIsHost);
  const source = useClientStore((s) => s.sourceCampaign);
  const ready = useClientStore((s) => s.ready);
  const { send, error } = useSubmit();
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  if (!realIsHost || !source) return null;
  const thumbnail = campaignThumbnail(source);

  async function upload(file: File) {
    setBusy(true);
    setUploadError(null);
    try {
      const { hash } = await defaultUploader(file);
      await send(brandingIntent({ screenshot: hash }));
    } catch (e) {
      setUploadError(e instanceof UploadError ? uploadFailureMessage(e) : 'The upload failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset className="ui-campaign-thumbnail">
      <legend>Campaign thumbnail</legend>
      {thumbnail ? (
        <img src={`/assets/${thumbnail}`} alt="Campaign thumbnail" width={160} />
      ) : (
        <p>No thumbnail yet. Ending the game saves one from the board as spectators see it.</p>
      )}
      <label>
        Upload thumbnail{' '}
        <input
          type="file"
          accept={THUMBNAIL_TYPES.join(',')}
          disabled={!ready || busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void upload(file);
          }}
        />
      </label>
      {source.screenshot && (
        <button
          type="button"
          disabled={!ready || busy}
          onClick={() => {
            void send(brandingIntent({ screenshot: null }));
          }}
        >
          Remove uploaded thumbnail
        </button>
      )}
      {uploadError && <p role="alert">{uploadError}</p>}
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
