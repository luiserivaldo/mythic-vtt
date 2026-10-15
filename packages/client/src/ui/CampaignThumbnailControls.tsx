import { campaignThumbnail } from '@mythic/shared';
import { useContext, useState, useSyncExternalStore } from 'react';
import { UploadError, uploadFailureMessage } from '../assets/image-upload.js';
import { boardCanvas, renderBoardThumbnail } from '../render/board-capture.js';
import { ClientStoreContext, useClientStore } from '../store/react.js';
import {
  brandingIntent,
  capturePublicBoard,
  signOutStore,
  signOutWithThumbnail,
  THUMBNAIL_TYPES,
} from './campaign-thumbnail.js';
import { defaultUploader } from './default-uploader.js';
import { useJoinEnv } from './join-context.js';
import './join-screen.css';
import { useSubmit } from './submit.js';

/**
 * UI-HOST-02 (UX-05), host DM only: the campaign list thumbnail (an upload, else the board as
 * spectators see it, captured on sign-out) and the sign-out itself.
 */
export function CampaignThumbnailControls() {
  const realIsHost = useClientStore((s) => s.realIsHost);
  const source = useClientStore((s) => s.sourceCampaign);
  const ready = useClientStore((s) => s.ready);
  const store = useContext(ClientStoreContext);
  const env = useJoinEnv();
  const { send, error } = useSubmit();
  const [busy, setBusy] = useState<'upload' | 'sign-out' | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  if (!realIsHost || !source) return null;
  const thumbnail = campaignThumbnail(source);

  async function upload(file: File) {
    setBusy('upload');
    setUploadError(null);
    try {
      const { hash } = await defaultUploader(file);
      await send(brandingIntent({ screenshot: hash }));
    } catch (e) {
      setUploadError(e instanceof UploadError ? uploadFailureMessage(e) : 'The upload failed.');
    } finally {
      setBusy(null);
    }
  }

  async function signOut() {
    if (!store || !env) return;
    setBusy('sign-out');
    const profile = env.session.currentProfile();
    await signOutWithThumbnail({
      capture: () => {
        const canvas = boardCanvas();
        return canvas
          ? capturePublicBoard(
              {
                getState: () => store.getState(),
                setViewAs: (audience) => {
                  store.getState().setViewAs(audience);
                },
                setSpectatorSource: (seatId) => {
                  store.getState().setSpectatorSource(seatId);
                },
              },
              () => renderBoardThumbnail(canvas),
            )
          : Promise.resolve(null);
      },
      upload: defaultUploader,
      send,
      stop: env.session.stop,
    });
    setBusy(null);
    signOutStore.setState({ signedOut: profile ?? { displayName: 'Game Master' } });
  }

  return (
    <fieldset className="ui-campaign-thumbnail">
      <legend>Campaign thumbnail</legend>
      {thumbnail ? (
        <img src={`/assets/${thumbnail}`} alt="Campaign thumbnail" width={160} />
      ) : (
        <p>No thumbnail yet. Signing out saves one from the board as spectators see it.</p>
      )}
      <label>
        Upload thumbnail{' '}
        <input
          type="file"
          accept={THUMBNAIL_TYPES.join(',')}
          disabled={!ready || busy !== null}
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
          disabled={!ready || busy !== null}
          onClick={() => {
            void send(brandingIntent({ screenshot: null }));
          }}
        >
          Remove uploaded thumbnail
        </button>
      )}
      <button
        type="button"
        disabled={!ready || busy !== null}
        onClick={() => {
          void signOut();
        }}
      >
        {busy === 'sign-out' ? 'Signing out…' : 'Sign out'}
      </button>
      {uploadError && <p role="alert">{uploadError}</p>}
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}

/** After the DM signs out: the table is gone until they sign back in (same identity). */
export function SignedOutScreen() {
  const env = useJoinEnv();
  const profile = useSyncExternalStore(
    signOutStore.subscribe,
    () => signOutStore.getState().signedOut,
  );
  if (!profile || !env) return null;
  return (
    <div className="join-backdrop">
      <section className="join-card" role="dialog" aria-label="Signed out">
        <p>You have signed out.</p>
        <button
          type="button"
          onClick={() => {
            signOutStore.setState({ signedOut: null });
            env.session.start(profile);
          }}
        >
          Sign back in
        </button>
      </section>
    </div>
  );
}
