import type { ServerMessage } from '@mythic/protocol';
import { visibleTo, type Audience, type Campaign } from '@mythic/shared';
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
  /** UX-14: the received state is retained for patch application and the DM's audience picker. */
  sourceCampaign: Campaign | null;
  realIsHost: boolean;
  realSeatId: string | null;
  viewAs: Audience;
  spectatorSeatId: string | null;
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
  } | null;
  notices: Notice[];
  /** Fatal host error, e.g. protocol mismatch; shown instead of the table. */
  fatalError: string | null;
  /** UI-JOIN-01: refused `join` requests so far and the last reason, for the join screen. */
  joinRefusals: { count: number; message: string };
  pendingIntents: number;
}

export interface ClientActions {
  setConnection(status: ConnectionStatus, error?: string): void;
  setPendingIntents(n: number): void;
  setHost(isHost: boolean): void;
  setViewAs: (audience: Audience) => void;
  setSpectatorSource: (seatId: string | null) => void;
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
  sourceCampaign: null,
  realIsHost: false,
  realSeatId: null,
  viewAs: { kind: 'host' },
  spectatorSeatId: null,
  seq: null,
  seatId: null,
  isHost: false,
  presence: null,
  notices: [],
  fatalError: null,
  joinRefusals: { count: 0, message: '' },
  pendingIntents: 0,
};

/** Recompute from the received state, never from a previously filtered preview (PERM-04). */
function project(
  state: ClientState,
): Pick<ClientState, 'campaign' | 'isHost' | 'seatId' | 'viewAs'> {
  let viewAs = state.realIsHost ? state.viewAs : { kind: 'host' as const };
  const source = state.sourceCampaign;
  if (viewAs.kind === 'seat' && !source?.seats[viewAs.seatId]) viewAs = { kind: 'spectators' };
  if (viewAs.kind === 'host') {
    return { campaign: source, isHost: state.realIsHost, seatId: state.realSeatId, viewAs };
  }
  const spectatorSeat = state.spectatorSeatId ? source?.seats[state.spectatorSeatId] : undefined;
  const audience =
    viewAs.kind === 'spectators' && spectatorSeat?.role === 'player'
      ? { kind: 'seat' as const, seatId: spectatorSeat.id }
      : viewAs;
  return {
    campaign: source ? visibleTo(audience, source) : null,
    isHost: false,
    seatId: viewAs.kind === 'seat' ? viewAs.seatId : null,
    viewAs,
  };
}

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
      const next = { ...get(), realIsHost: isHost };
      set({ realIsHost: isHost, ...project(next) });
    },

    setViewAs(viewAs) {
      if (!get().realIsHost || (viewAs.kind !== 'host' && get().pendingIntents > 0)) return;
      set(project({ ...get(), viewAs }));
    },

    setSpectatorSource(spectatorSeatId) {
      set({ spectatorSeatId, ...project({ ...get(), spectatorSeatId }) });
    },

    dismissNotice(index) {
      set({ notices: get().notices.filter((_, i) => i !== index) });
    },

    applyServerMessage(message) {
      switch (message.t) {
        case 'snapshot': {
          const campaign = parseSnapshot(message.state);
          if (!campaign) return 'resync';
          const next = { ...get(), sourceCampaign: campaign, realSeatId: message.seatId };
          // A different campaign must not inherit another table's audience selection.
          if (get().sourceCampaign?.id !== campaign.id) next.viewAs = { kind: 'host' };
          set({
            sourceCampaign: campaign,
            realSeatId: message.seatId,
            seq: message.seq,
            ready: true,
            ...project(next),
          });
          return 'ok';
        }
        case 'patch': {
          const { sourceCampaign: campaign, seq } = get();
          if (!campaign || seq === null) return 'resync';
          const outcome = applyPatchMessage(campaign, seq, message.seq, message.patches);
          if (outcome.kind === 'applied') {
            set({
              sourceCampaign: outcome.campaign,
              seq: outcome.seq,
              ready: true,
              ...project({ ...get(), sourceCampaign: outcome.campaign }),
            });
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
          else if (message.code === 'seat-unavailable')
            set({
              joinRefusals: { count: get().joinRefusals.count + 1, message: message.message },
            });
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
