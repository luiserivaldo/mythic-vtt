import { changeSpectatorLink, spectatorUrl } from './spectator-link.js';
import { useState } from 'react';
import { copyJoinUrl, playerVisibleUrl, type JoinUrl } from './share-panel.js';

interface Props {
  joinUrls: readonly JoinUrl[];
}

export function SharePanel({ joinUrls }: Props) {
  const [status, setStatus] = useState<string | null>(null);
  const [watchToken, setWatchToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const change = async (method: 'POST' | 'DELETE') => {
    setBusy(true);
    try {
      setWatchToken(await changeSpectatorLink(method));
      setStatus(
        method === 'POST'
          ? 'New spectator link ready. Previous links revoked.'
          : 'Spectator link revoked.',
      );
    } catch {
      setStatus('Could not change the spectator link.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ui-panel" aria-labelledby="share-heading">
      <h2 id="share-heading">Invite players</h2>
      {joinUrls.length === 0 ? (
        <p>No player join URL is available. Start the host in LAN mode or set MYTHIC_PUBLIC_URL.</p>
      ) : (
        <ul className="ui-list">
          {joinUrls.map((entry, index) => {
            const url = playerVisibleUrl(entry.url);
            const key = `${entry.kind}-${String(index)}`;
            return (
              <li className="ui-share-row" key={key}>
                <span className="ui-badge">{entry.kind === 'lan' ? 'LAN' : 'Public'}</span>
                <a href={url} target="_blank" rel="noreferrer">
                  {url}
                </a>
                <button
                  type="button"
                  onClick={() => {
                    void copyJoinUrl(url, navigator.clipboard).then(
                      () => {
                        setStatus(`Copied ${entry.kind} join URL`);
                      },
                      () => {
                        setStatus('Could not copy the join URL');
                      },
                    );
                  }}
                >
                  Copy
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <h3>Spectators</h3>
      <p>Read-only player view. No name or seat required.</p>
      {watchToken &&
        joinUrls.map((entry, index) => {
          const url = spectatorUrl(playerVisibleUrl(entry.url), watchToken);
          return (
            <div className="ui-share-row" key={`watch-${String(index)}`}>
              <a href={url} target="_blank" rel="noreferrer">
                {url}
              </a>
              <button
                type="button"
                onClick={() => {
                  void copyJoinUrl(url, navigator.clipboard).then(
                    () => {
                      setStatus('Copied spectator link');
                    },
                    () => {
                      setStatus('Could not copy spectator link');
                    },
                  );
                }}
              >
                Copy spectator link
              </button>
            </div>
          );
        })}
      <button
        type="button"
        disabled={busy || joinUrls.length === 0}
        onClick={() => {
          void change('POST');
        }}
      >
        Generate new spectator link
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          void change('DELETE');
        }}
      >
        Revoke spectator link
      </button>
      {status && <p role="status">{status}</p>}
    </section>
  );
}
