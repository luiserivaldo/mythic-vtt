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
  start: (profile: Pick<Profile, 'displayName' | 'avatar'>) => void;
  stop: () => void;
  started: () => boolean;
  currentProfile: () => Pick<Profile, 'displayName' | 'avatar'> | null;
  subscribe: (listener: () => void) => () => void;
  joinSeat: (seatId: string) => void;
  /** Stable for the whole page, so contexts never change; fails fast until a client exists. */
  submitIntent: SubmitIntent;
  sendEphemeral: (channel: string, data: unknown) => void;
  onEphemeral: (listener: Parameters<GameClient['onEphemeral']>[0]) => () => void;
}

export function createSession(deps: SessionDeps): Session {
  let client: GameClient | undefined;
  let currentProfile: Pick<Profile, 'displayName' | 'avatar'> | null = null;
  const listeners = new Set<() => void>();
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
        ...(profile.avatar !== undefined ? { avatar: profile.avatar } : {}),
        ...(deps.hostToken !== undefined ? { hostToken: deps.hostToken } : {}),
        store: deps.store,
        createSocket: deps.createSocket,
      });
      client.start();
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
    joinSeat(seatId) {
      client?.join({ seatId });
    },
    sendEphemeral: (channel, data) => client?.sendEphemeral(channel, data),
    onEphemeral: (listener) => {
      const unsubscribe = client?.onEphemeral(listener);
      return () => unsubscribe?.();
    },
    submitIntent: (type, payload, sceneId) =>
      client
        ? client.submitIntent(type, payload, sceneId)
        : Promise.resolve({ ok: false as const, reason: 'connection-lost' as const }),
  };
}
