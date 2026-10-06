import type { StoreApi } from 'zustand/vanilla';
import { createGameClient, type GameClient, type GameClientOptions } from '../net/client.js';
import type { HostTokenHolder } from '../net/host-token.js';
import type { Identity } from '../net/identity.js';
import type { ClientStore } from '../store/store.js';
import type { Profile } from './join-screen.js';
import type { SubmitIntent } from './submit.js';
import type { ServerMessage } from '@mythic/protocol';

type Ephemeral = Extract<ServerMessage, { t: 'ephemeral' }>;

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
  subscribe: (listener: () => void) => () => void;
  joinSeat: (seatId: string) => void;
  /** Stable for the whole page, so contexts never change; fails fast until a client exists. */
  submitIntent: SubmitIntent;
  sendEphemeral: (channel: string, data: unknown) => void;
  onEphemeral: (listener: (message: Ephemeral) => void) => () => void;
}

export function createSession(deps: SessionDeps): Session {
  let client: GameClient | undefined;
  let detachEphemerals: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const ephemeralListeners = new Set<(message: Ephemeral) => void>();
  const notify = () => {
    for (const l of listeners) l();
  };
  return {
    start(profile) {
      detachEphemerals?.();
      client?.stop();
      client = createGameClient({
        url: deps.url,
        identity: deps.identity,
        displayName: profile.displayName,
        ...(profile.avatar !== undefined ? { avatar: profile.avatar } : {}),
        ...(deps.hostToken !== undefined ? { hostToken: deps.hostToken } : {}),
        store: deps.store,
        createSocket: deps.createSocket,
      });
      detachEphemerals = client.onEphemeral((message) => {
        for (const listener of ephemeralListeners) listener(message);
      });
      client.start();
      notify();
    },
    stop() {
      detachEphemerals?.();
      detachEphemerals = undefined;
      client?.stop();
      client = undefined;
      notify();
    },
    started: () => client !== undefined,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    joinSeat(seatId) {
      client?.join({ seatId });
    },
    submitIntent: (type, payload, sceneId) =>
      client
        ? client.submitIntent(type, payload, sceneId)
        : Promise.resolve({ ok: false as const, reason: 'connection-lost' as const }),
    sendEphemeral(channel, data) {
      client?.sendEphemeral(channel, data);
    },
    onEphemeral(listener) {
      ephemeralListeners.add(listener);
      return () => ephemeralListeners.delete(listener);
    },
  };
}
