import { useContext, useState, useSyncExternalStore } from 'react';
import { createStore } from 'zustand/vanilla';
import { boardCanvas, renderBoardThumbnail } from '../render/board-capture.js';
import { ClientStoreContext, useClientStore } from '../store/react.js';
import { capturePublicBoard, endGameWithThumbnail } from './campaign-thumbnail.js';
import { defaultUploader } from './default-uploader.js';
import { useJoinEnv } from './join-context.js';
import type { Profile } from './join-screen.js';
import './join-screen.css';
import { useSubmit } from './submit.js';

/** Set once this viewer has left the table: the board is replaced by a card until they return. */
export const gameExitStore = createStore<{
  exited: {
    kind: 'ended' | 'left';
    profile: Pick<Profile, 'displayName' | 'avatar' | 'color'>;
  } | null;
}>()(() => ({ exited: null }));

/**
 * UX-05b (MV-273): the host is the DM and cannot sign out, only end the game: capture the board
 * as spectators see it for the campaign list (UI-HOST-02), then stop the session. Everyone else
 * (players, co-DMs, spectators) leaves the game instead.
 */
export function GameExitButton() {
  const realIsHost = useClientStore((s) => s.realIsHost);
  const ready = useClientStore((s) => s.ready);
  const store = useContext(ClientStoreContext);
  const env = useJoinEnv();
  const { send, error } = useSubmit();
  const [busy, setBusy] = useState(false);
  if (!env) return null;
  const profile = () => env.session.currentProfile() ?? { displayName: 'Game Master' };

  async function endGame() {
    if (!store || !env) return;
    setBusy(true);
    const before = profile();
    await endGameWithThumbnail({
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
    setBusy(false);
    gameExitStore.setState({ exited: { kind: 'ended', profile: before } });
  }

  if (realIsHost)
    return (
      <>
        <button
          type="button"
          className="ui-danger-button"
          disabled={!ready || busy}
          onClick={() => {
            void endGame();
          }}
        >
          {busy ? 'Ending game…' : 'End Game'}
        </button>
        {error && <p role="alert">{error}</p>}
      </>
    );
  return (
    <button
      type="button"
      onClick={() => {
        const before = profile();
        env.session.stop();
        gameExitStore.setState({ exited: { kind: 'left', profile: before } });
      }}
    >
      Leave Game
    </button>
  );
}

/**
 * After End Game the DM signs back in with the same identity. A visitor who left reloads the
 * page, which takes them back through whichever entrance they came by (join, spectator link).
 */
export function GameExitScreen({
  reload = () => {
    location.reload();
  },
}: {
  reload?: () => void;
}) {
  const env = useJoinEnv();
  const exited = useSyncExternalStore(
    gameExitStore.subscribe,
    () => gameExitStore.getState().exited,
  );
  if (!exited || !env) return null;
  const ended = exited.kind === 'ended';
  return (
    <div className="join-backdrop">
      <section
        className="join-card"
        role="dialog"
        aria-label={ended ? 'Game ended' : 'Left the game'}
      >
        <p>{ended ? 'You have ended the game.' : 'You have left the game.'}</p>
        <button
          type="button"
          onClick={() => {
            gameExitStore.setState({ exited: null });
            if (ended) env.session.start(exited.profile);
            else reload();
          }}
        >
          {ended ? 'Sign back in' : 'Rejoin'}
        </button>
      </section>
    </div>
  );
}
