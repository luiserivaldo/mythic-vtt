import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { createGameClient } from './net/client.js';
import { loadOrCreateIdentity } from './net/identity.js';
import { ClientStoreContext } from './store/react.js';
import { createClientStore } from './store/store.js';

// The browser edge is the only place that supplies the clock and randomness (SES-02).
const randomByte = () => crypto.getRandomValues(new Uint8Array(1))[0] ?? 0;
const identity = loadOrCreateIdentity(localStorage, Date.now(), randomByte);

const store = createClientStore();
const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
const client = createGameClient({
  url: `${wsProtocol}//${location.host}/ws`,
  identity,
  displayName: 'Player',
  store,
  createSocket: (url) => new WebSocket(url),
});
client.start();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('missing #root');
createRoot(rootEl).render(
  <StrictMode>
    <ClientStoreContext.Provider value={store}>
      <App />
    </ClientStoreContext.Provider>
  </StrictMode>,
);
