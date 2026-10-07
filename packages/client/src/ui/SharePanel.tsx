import { useState } from 'react';
import { copyJoinUrl, playerVisibleUrl, type JoinUrl } from './share-panel.js';

interface Props {
  joinUrls: readonly JoinUrl[];
}

export function SharePanel({ joinUrls }: Props) {
  const [status, setStatus] = useState<string | null>(null);

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
      {status && <p role="status">{status}</p>}
    </section>
  );
}
