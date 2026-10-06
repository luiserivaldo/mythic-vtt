import type { ClientMessage, ServerMessage } from '@mythic/protocol';
import type { StoreApi } from 'zustand/vanilla';
import type { ClientStore } from '../store/store.js';
import type { BackoffOptions } from './backoff.js';
import { createConnection, type SocketLike } from './connection.js';
import type { Identity } from './identity.js';
import type { HostTokenHolder } from './host-token.js';
import { createIntentQueue, type IntentResult } from './intents.js';

export interface GameClientOptions {
  url: string;
  identity: Identity;
  displayName: string;
  avatar?: string;
  /** D24/D29: host token, resent in hello until the first snapshot confirms the bind. */
  hostToken?: HostTokenHolder;
  store: StoreApi<ClientStore>;
  createSocket(url: string): SocketLike;
  random?: () => number;
  backoff?: BackoffOptions;
  heartbeatMs?: number;
  pongTimeoutMs?: number;
  ackTimeoutMs?: number;
}

type Ephemeral = Extract<ServerMessage, { t: 'ephemeral' }>;

/** Wires connection, store and intent queue together. UI and tools talk only to this. */
export function createGameClient(options: GameClientOptions) {
  const { store } = options;
  const ephemeralListeners = new Set<(m: Ephemeral) => void>();

  const intents = createIntentQueue({
    ackTimeoutMs: options.ackTimeoutMs,
    send: (i) => {
      conn.send({
        t: 'intent',
        type: i.type,
        payload: i.payload,
        clientRef: i.clientRef,
        ...(i.sceneId !== undefined ? { sceneId: i.sceneId } : {}),
      });
    },
    onChange: (n) => {
      store.getState().setPendingIntents(n);
    },
  });

  const conn = createConnection({
    url: options.url,
    createSocket: (url) => options.createSocket(url),
    hello: () => {
      const hostToken = options.hostToken?.take();
      return {
        identityId: options.identity.identityId,
        identitySecret: options.identity.identitySecret,
        displayName: options.displayName,
        ...(options.avatar !== undefined ? { avatar: options.avatar } : {}),
        ...(hostToken !== undefined ? { hostToken } : {}),
      };
    },
    lastSeq: () => store.getState().seq ?? undefined,
    random: options.random,
    backoff: options.backoff,
    heartbeatMs: options.heartbeatMs,
    pongTimeoutMs: options.pongTimeoutMs,
    onStatus: (status, detail) => {
      store.getState().setConnection(status, detail?.error);
      if (status !== 'open') intents.setConnected(false);
    },
    onMessage: (msg) => {
      switch (msg.t) {
        case 'ack':
          intents.handleAck(msg.clientRef, msg.seq);
          return;
        case 'reject':
          intents.handleReject(msg.clientRef, msg.reason, msg.detail);
          return;
        case 'ephemeral':
          for (const l of ephemeralListeners) l(msg);
          return;
        default: {
          const result = store.getState().applyServerMessage(msg);
          if (result === 'resync') {
            intents.setConnected(false);
            conn.reconnectNow();
            return;
          }
          // A snapshot is only sent to an authenticated connection, so the token is spent.
          if (msg.t === 'snapshot') options.hostToken?.confirm();
          // Intents wait for the first valid state so the host has a seat for us.
          if (store.getState().ready) intents.setConnected(true);
        }
      }
    },
  });

  return {
    start: () => {
      conn.start();
    },
    stop: () => {
      conn.stop();
    },
    /** Submit an action intent; resolves on the host's ack or reject. */
    submitIntent: (type: string, payload: unknown, sceneId?: string): Promise<IntentResult> =>
      intents.submit(type, payload, sceneId),
    join(fields: Omit<Extract<ClientMessage, { t: 'join' }>, 't'>): void {
      conn.send({ t: 'join', ...fields });
    },
    sendEphemeral(channel: string, data: unknown): void {
      conn.send({ t: 'ephemeral', channel, data });
    },
    onEphemeral(listener: (m: Ephemeral) => void): () => void {
      ephemeralListeners.add(listener);
      return () => ephemeralListeners.delete(listener);
    },
  };
}

export type GameClient = ReturnType<typeof createGameClient>;
