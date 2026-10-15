import type { StoreApi } from 'zustand/vanilla';
import { createGameClient, type GameClient, type GameClientOptions } from '../net/client.js';
import type { HostTokenHolder } from '../net/host-token.js';
import type { Identity } from '../net/identity.js';
import type { ClientStore } from '../store/store.js';
import type { Profile } from './join-screen.js';
import type { SubmitIntent } from './submit.js';

export interface SessionDeps {
  url: string;
  identity: Identity;
  store: StoreApi<ClientStore>;
  hostToken?: HostTokenHolder;
  createSocket: GameClientOptions['createSocket'];
}

/**
 * Owns the game client so connecting can wait for the visitor's chosen name: the protocol has a
 * single `hello` per connection and no rename, so the name must be known before the socket opens.
 * Changing the name later stops the client and starts a new one.
 */
export interface Session {
  start: (profile: Pick<Profile, 'displayName' | 'avatar' | 'color'>) => void;
  stop: () => void;
  started: () => boolean;
  currentProfile: () => Pick<Profile, 'displayName' | 'avatar' | 'color'> | null;
  subscribe: (listener: () => void) => () => void;
  /** Sends `join` on the current connection: a seat claim, a temporary seat or spectating. */
  join: (fields: Parameters<GameClient['join']>[0]) => void;
  /** Stable for the whole page, so contexts never change; fails fast until a client exists. */
  submitIntent: SubmitIntent;
  sendEphemeral: (channel: string, data: unknown) => void;
  onEphemeral: (listener: Parameters<GameClient['onEphemeral']>[0]) => () => void;
}

export function createSession(deps: SessionDeps): Session {
  let client: GameClient | undefined;
  let currentProfile: Pick<Profile, 'displayName' | 'avatar' | 'color'> | null = null;
  const listeners = new Set<() => void>();
  // M4-13 (LAY-05): the board mounts behind the join screen, so a tool asks for the ephemeral
  // stream while there is no socket yet. Keep those requests here and attach them to every client
  // the session starts, so a visitor who joins later — and one whose client is replaced — gets the
  // remote rulers, drag previews and drawings the tools subscribe to.
  const ephemeralListeners = new Map<Parameters<GameClient['onEphemeral']>[0], () => void>();
  const attachEphemeral = () => {
    const current = client;
    for (const [listener, detach] of ephemeralListeners) {
      detach();
      // Setting an existing key keeps the iteration order and size, so this map stays safe to walk.
      ephemeralListeners.set(listener, current ? current.onEphemeral(listener) : () => undefined);
    }
  };
  const notify = () => {
    for (const l of listeners) l();
  };
  return {
    start(profile) {
      client?.stop();
      currentProfile = profile;
      client = createGameClient({
        url: deps.url,
        identity: deps.identity,
        displayName: profile.displayName,
        ...(profile.color !== undefined ? { color: profile.color } : {}),
        ...(profile.avatar !== undefined ? { avatar: profile.avatar } : {}),
        ...(deps.hostToken !== undefined ? { hostToken: deps.hostToken } : {}),
        store: deps.store,
        createSocket: deps.createSocket,
      });
      client.start();
      attachEphemeral();
      notify();
    },
    stop() {
      client?.stop();
      client = undefined;
      currentProfile = null;
      notify();
    },
    started: () => client !== undefined,
    currentProfile: () => currentProfile,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    join(fields) {
      client?.join(fields);
    },
    sendEphemeral: (channel, data) => client?.sendEphemeral(channel, data),
    onEphemeral: (listener) => {
      ephemeralListeners.set(listener, client?.onEphemeral(listener) ?? (() => undefined));
      return () => {
        ephemeralListeners.get(listener)?.();
        ephemeralListeners.delete(listener);
      };
    },
    submitIntent: (type, payload, sceneId) =>
      client
        ? client.submitIntent(type, payload, sceneId)
        : Promise.resolve({ ok: false as const, reason: 'connection-lost' as const }),
  };
}
