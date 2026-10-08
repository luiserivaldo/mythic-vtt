import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { createHostTokenHolder, extractHostToken } from './net/host-token.js';
import { loadOrCreateIdentity } from './net/identity.js';
import { ClientStoreContext } from './store/react.js';
import { createClientStore } from './store/store.js';
import { JoinContext } from './ui/join-context.js';
import { loadProfile } from './ui/join-screen.js';
import { createSession } from './ui/session.js';
import { SubmitProvider } from './ui/SubmitProvider.js';
import { EphemeralContext } from './ui/ephemeral-context.js';
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
    if (!s.ready) return;
    // Unsubscribe first: setHost changes the store, which would re-enter this callback forever.
    unsubscribe();
    s.setHost(true);
    try {
      localStorage.setItem(HOST_HINT, '1');
    } catch {
      // Private mode: the hint just won't survive a reload.
    }
  });
}
const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
// SES-01: a visitor chooses a name (and seat) on the join screen before the socket opens, because
// `hello` carries the display name. The DM link (and a remembered host) skips the screen.
const session = createSession({
  url: `${wsProtocol}//${location.host}/ws`,
  identity,
  hostToken: hostTokenHolder,
  store,
  createSocket: (url) => new WebSocket(url),
});
const hostVisitor = hostToken !== undefined || remembered;
const initialProfile = loadProfile(localStorage);
if (hostVisitor) session.start({ displayName: initialProfile?.displayName ?? 'DM' });
else if (initialProfile) session.start(initialProfile);

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('missing #root');
createRoot(rootEl).render(
  <StrictMode>
    <ClientStoreContext.Provider value={store}>
      <UiStoreContext.Provider value={uiStore}>
        <SubmitProvider submit={session.submitIntent}>
          <EphemeralContext.Provider
            value={{
              identityId: identity.identityId,
              send: session.sendEphemeral,
              on: session.onEphemeral,
            }}
          >
            <JoinContext.Provider
              value={{
                session,
                storage: localStorage,
                identityId: identity.identityId,
                hostVisitor,
                initialProfile,
              }}
            >
              <App />
            </JoinContext.Provider>
          </EphemeralContext.Provider>
        </SubmitProvider>
      </UiStoreContext.Provider>
    </ClientStoreContext.Provider>
  </StrictMode>,
);
