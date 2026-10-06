import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { createGameClient } from './net/client.js';
import { createHostTokenHolder, extractHostToken } from './net/host-token.js';
import { loadOrCreateIdentity } from './net/identity.js';
import { ClientStoreContext } from './store/react.js';
import { createClientStore } from './store/store.js';
import { SubmitContext } from './ui/submit.js';
import { createUiStore, UiStoreContext } from './ui/ui-store.js';

// The browser edge is the only place that supplies the clock and randomness (SES-02).
const randomByte = () => crypto.getRandomValues(new Uint8Array(1))[0] ?? 0;
const identity = loadOrCreateIdentity(localStorage, Date.now(), randomByte);

// D24: the DM link carries `#host=<token>`; read it once and scrub it from the address bar.
const hostToken = extractHostToken(location, history);
const hostTokenHolder = createHostTokenHolder(hostToken);

const store = createClientStore();
const uiStore = createUiStore();

// The server sends no role, so remember a successful host claim (the token is scrubbed from the
// URL, but the gateway keeps recognising this identity as host). UI hint only; the host re-checks.
const HOST_HINT = 'mythic.host';
const remembered = (() => {
  try {
    return localStorage.getItem(HOST_HINT) === '1';
  } catch {
    return false;
  }
})();
if (remembered) store.getState().setHost(true);
if (hostToken !== undefined) {
  const unsubscribe = store.subscribe((s) => {
    if (s.ready) {
      s.setHost(true);
      try {
        localStorage.setItem(HOST_HINT, '1');
      } catch {
        // Private mode: the hint just won't survive a reload.
      }
      unsubscribe();
    }
  });
}
const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
const client = createGameClient({
  url: `${wsProtocol}//${location.host}/ws`,
  identity,
  displayName: 'Player',
  hostToken: hostTokenHolder,
  store,
  createSocket: (url) => new WebSocket(url),
});
client.start();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('missing #root');
createRoot(rootEl).render(
  <StrictMode>
    <ClientStoreContext.Provider value={store}>
      <UiStoreContext.Provider value={uiStore}>
        <SubmitContext.Provider value={client.submitIntent}>
          <App />
        </SubmitContext.Provider>
      </UiStoreContext.Provider>
    </ClientStoreContext.Provider>
  </StrictMode>,
);
