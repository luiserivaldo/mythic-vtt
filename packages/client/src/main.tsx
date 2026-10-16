import { ViewerPreferencesProvider } from './ui/ViewerPreferencesProvider.js';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { createHostTokenHolder, extractHostToken } from './net/host-token.js';
import { SPECTATOR_IDENTITY_STORAGE_KEY, loadOrCreateIdentity } from './net/identity.js';
import { extractSeatInvite, redeemSeatInvite, seatInviteMessage } from './net/seat-invite.js';
import { ClientStoreContext } from './store/react.js';
import { createClientStore } from './store/store.js';
import { HOST_SCREEN_KEY } from './ui/host-screen.js';
import { JoinContext, RETURNING_KEY } from './ui/join-context.js';
import { loadProfile, migrateLegacyProfile } from './ui/join-screen.js';
import { createSession } from './ui/session.js';
import { SubmitProvider } from './ui/SubmitProvider.js';
import { EphemeralContext } from './ui/ephemeral-context.js';
import { createUiStore, UiStoreContext } from './ui/ui-store.js';

// The browser edge is the only place that supplies the clock and randomness (SES-02).
const randomByte = () => crypto.getRandomValues(new Uint8Array(1))[0] ?? 0;
const watchToken = new URLSearchParams(location.hash.slice(1)).get('watch');
const watchVisitor = watchToken !== null;
const identity = loadOrCreateIdentity(
  watchVisitor ? { getItem: () => null, setItem: () => undefined } : localStorage,
  Date.now(),
  randomByte,
);

// D24: the DM link carries `#host=<token>`; read it once and scrub it from the address bar.
const hostToken = watchVisitor ? undefined : extractHostToken(location, history);
const hostTokenHolder = createHostTokenHolder(hostToken);
// SES-04: `#invite=<seatId>.<token>`, read once and scrubbed like the host token.
const seatInvite =
  watchVisitor || hostToken !== undefined ? undefined : extractSeatInvite(location, history);

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
if (remembered && !watchVisitor) store.getState().setHost(true);
if (hostToken !== undefined && !watchVisitor) {
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
  url: `${wsProtocol}//${location.host}/ws${watchVisitor ? `?watch=${encodeURIComponent(watchToken)}` : ''}`,
  identity,
  spectatorIdentity: () =>
    loadOrCreateIdentity(localStorage, Date.now(), randomByte, SPECTATOR_IDENTITY_STORAGE_KEY),
  hostToken: hostTokenHolder,
  store,
  createSocket: (url) => new WebSocket(url),
});
const hostVisitor = !watchVisitor && (hostToken !== undefined || remembered);
if (!watchVisitor) migrateLegacyProfile(localStorage);
const initialProfile = loadProfile(localStorage);
// UI-HOST-01: "I'm the DM" opened the DM link; read once. Only a host visitor ever uses it.
const hostScreen = (() => {
  try {
    const flag = sessionStorage.getItem(HOST_SCREEN_KEY) === '1';
    sessionStorage.removeItem(HOST_SCREEN_KEY);
    return flag && hostVisitor;
  } catch {
    return false;
  }
})();
const returning = (() => {
  try {
    const flag = sessionStorage.getItem(RETURNING_KEY) === '1';
    sessionStorage.removeItem(RETURNING_KEY);
    return flag;
  } catch {
    return false;
  }
})();
if (watchVisitor) session.start({ displayName: 'Spectator' });
else if (hostVisitor)
  session.start({
    displayName: initialProfile?.displayName ?? 'DM',
    ...(initialProfile?.color !== undefined ? { color: initialProfile.color } : {}),
  });
else if (seatInvite) {
  // The host learns this identity from `hello`, so connect first, then redeem the invite. The
  // seat arrives through the normal patch stream; a failure leaves the usual join screen.
  session.start(initialProfile ?? { displayName: 'Player' });
  const unsubscribe = store.subscribe((s) => {
    if (!s.ready) return;
    unsubscribe();
    void redeemSeatInvite(identity, seatInvite).then((result) => {
      const message = seatInviteMessage(result);
      if (message) window.alert(message);
    });
  });
} else if (initialProfile) session.start(initialProfile);

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
              color: () => session.currentProfile()?.color,
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
                hostScreen,
                readOnlyVisitor: watchVisitor,
                initialProfile,
                returning,
              }}
            >
              <ViewerPreferencesProvider>
                <App />
              </ViewerPreferencesProvider>
            </JoinContext.Provider>
          </EphemeralContext.Provider>
        </SubmitProvider>
      </UiStoreContext.Provider>
    </ClientStoreContext.Provider>
  </StrictMode>,
);
