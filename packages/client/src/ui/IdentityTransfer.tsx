import { useRef, useState } from 'react';
import { IDENTITY_STORAGE_KEY, type Identity } from '../net/identity.js';
import {
  IDENTITY_FILE_MAX_BYTES,
  installIdentityFile,
  parseIdentityFile,
  serializeIdentityFile,
} from '../net/identity-file.js';
import { useJoinEnv } from './join-context.js';

export function IdentityTransfer() {
  const env = useJoinEnv();
  const [pending, setPending] = useState<Identity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  if (!env) return null;

  const download = () => {
    try {
      const identity = parseIdentityFile(env.storage.getItem(IDENTITY_STORAGE_KEY) ?? '');
      const blob = new Blob([serializeIdentityFile(identity)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'mythic-identity.json';
      link.click();
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 1000);
      setError(null);
    } catch {
      setError('The identity backup could not be downloaded.');
    }
  };

  return (
    <details>
      <summary>Identity backup and transfer</summary>
      <p>
        This file contains your identity secret. Anyone with it can access your identity. Keep it
        private. Files are handled in this browser and are never uploaded.
      </p>
      <button type="button" onClick={download}>
        Download identity backup
      </button>
      <label>
        Identity file
        <input
          type="file"
          accept=".json,application/json"
          onChange={(event) => {
            const version = ++generation.current;
            setPending(null);
            setError(null);
            const file = event.target.files?.[0];
            if (!file) return;
            if (file.size > IDENTITY_FILE_MAX_BYTES) {
              setError('This is not a valid Mythic identity file.');
              return;
            }
            void file
              .text()
              .then((text) => {
                if (generation.current !== version) return;
                setPending(parseIdentityFile(text));
              })
              .catch(() => {
                if (generation.current === version)
                  setError('This is not a valid Mythic identity file.');
              });
          }}
        />
      </label>
      {pending && (
        <>
          <p>Identity: {pending.identityId}</p>
          <p>
            Import replaces this browser’s identity and reconnects. Campaign data stays on the game
            host.
          </p>
          <button
            type="button"
            onClick={() => {
              try {
                installIdentityFile(env.storage, pending);
                env.session.stop();
                window.location.reload();
              } catch {
                setError('The identity could not be saved. Check browser storage and try again.');
              }
            }}
          >
            Replace identity and reload
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
