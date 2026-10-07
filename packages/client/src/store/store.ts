import type { ServerMessage } from '@mythic/protocol';
import type { Campaign } from '@mythic/shared';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { ConnectionStatus } from '../net/connection.js';
import { applyPatchMessage, parseSnapshot } from './patches.js';

type Of<T extends ServerMessage['t']> = Extract<ServerMessage, { t: T }>;

export interface Notice {
  level: 'info' | 'warning';
  code: string;
  message: string;
}

export interface ClientState {
  connection: ConnectionStatus;
  /** True once a valid snapshot has arrived on the current connection. */
  ready: boolean;
  campaign: Campaign | null;
  /** Last applied `seq`; null until the first snapshot. */
  seq: number | null;
  seatId: string | null;
  /**
   * D24/D29: this client claimed host authority (DM link). The server sends no role, so this is a
   * UI hint only; the host still checks every intent. Hides DM panels, grants nothing.
   */
  isHost: boolean;
  presence: {
    seats: Of<'presence'>['seats'];
    spectators: number;
    /** M1-11: host-only roster of connected identities without a seat; absent for everyone else. */
    unseated?: Of<'presence'>['unseated'];
    /** M1-38: fragment-free player links, delivered by the host-only presence path. */
    joinUrls?: Of<'presence'>['joinUrls'];
  } | null;
  notices: Notice[];
  /** Fatal host error, e.g. protocol mismatch; shown instead of the table. */
  fatalError: string | null;
  pendingIntents: number;
}

export interface ClientActions {
  setConnection(status: ConnectionStatus, error?: string): void;
  setPendingIntents(n: number): void;
  setHost(isHost: boolean): void;
  dismissNotice(index: number): void;
  /**
   * Apply a host message. Returns 'resync' when state diverged and the caller must reconnect
   * so the host can replay or send a fresh snapshot.
   */
  applyServerMessage(message: ServerMessage): 'ok' | 'resync';
}

export type ClientStore = ClientState & ClientActions;

const MAX_NOTICES = 20;

const initial: ClientState = {
  connection: 'idle',
  ready: false,
  campaign: null,
  seq: null,
  seatId: null,
  isHost: false,
  presence: null,
  notices: [],
  fatalError: null,
  pendingIntents: 0,
};

/** Vanilla store so non-React code (net, tools, renderer) can subscribe; React uses `useClientStore`. */
export function createClientStore(): StoreApi<ClientStore> {
  return createStore<ClientStore>()((set, get) => ({
    ...initial,

    setConnection(status, error) {
      set({
        connection: status,
        // Keep the last campaign visible while reconnecting, but stop treating it as live.
        ...(status === 'open' || status === 'connecting' ? {} : { ready: false }),
        ...(status === 'failed' ? { fatalError: error ?? 'connection failed' } : {}),
      });
    },

    setPendingIntents: (pendingIntents) => {
      set({ pendingIntents });
    },

    setHost: (isHost) => {
      set({ isHost });
    },

    dismissNotice(index) {
      set({ notices: get().notices.filter((_, i) => i !== index) });
    },

    applyServerMessage(message) {
      switch (message.t) {
        case 'snapshot': {
          const campaign = parseSnapshot(message.state);
          if (!campaign) return 'resync';
          set({ campaign, seq: message.seq, seatId: message.seatId, ready: true });
          return 'ok';
        }
        case 'patch': {
          const { campaign, seq } = get();
          if (!campaign || seq === null) return 'resync';
          const outcome = applyPatchMessage(campaign, seq, message.seq, message.patches);
          if (outcome.kind === 'applied') {
            set({ campaign: outcome.campaign, seq: outcome.seq, ready: true });
            return 'ok';
          }
          return outcome.kind === 'stale' ? 'ok' : 'resync';
        }
        case 'presence':
          set({
            presence: {
              seats: message.seats,
              spectators: message.spectators,
              ...(message.unseated !== undefined ? { unseated: message.unseated } : {}),
              ...(message.joinUrls !== undefined ? { joinUrls: message.joinUrls } : {}),
            },
          });
          return 'ok';
        case 'notice':
          set({
            notices: [
              ...get().notices,
              { level: message.level, code: message.code, message: message.message },
            ].slice(-MAX_NOTICES),
          });
          return 'ok';
        case 'error':
          if (message.fatal) set({ fatalError: `${message.code}: ${message.message}` });
          return 'ok';
        // ack/reject belong to the intent queue; ephemeral and pong are not state.
        case 'ack':
        case 'reject':
        case 'ephemeral':
        case 'pong':
          return 'ok';
      }
    },
  }));
}
