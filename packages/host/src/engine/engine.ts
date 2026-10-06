import type { Patch } from 'immer';
import { encodeServerMessage, type ClientMessage, type ServerMessage } from '@mythic/protocol';
import {
  audienceKey,
  checkIntent,
  patchesFor,
  reduceAction,
  visibleTo,
  type ActionEnvelope,
  type Audience,
  type Campaign,
} from '@mythic/shared';
import type { GatewayConnection, GatewayHandler } from '../gateway/engine-seam.js';
import type { CampaignStore } from '../storage/types.js';
import { actorFor, audienceFor } from './audience.js';
import {
  cryptoRandom,
  randomFloats,
  systemClock,
  ulid,
  type Clock,
  type RandomSource,
} from './sources.js';

type Of<T extends ClientMessage['t']> = Extract<ClientMessage, { t: T }>;
type RejectReason = Extract<ServerMessage, { t: 'reject' }>['reason'];
type PatchMessage = Extract<ServerMessage, { t: 'patch' }>;

export interface EngineOptions {
  /** The campaign this room serves (already loaded and migrated). */
  campaign: Campaign;
  /** One id per host run; names the log file (`sessions/<sessionId>/log.jsonl`, §8.2). */
  sessionId: string;
  /** Only the log append is used here; scene/campaign autosave is M0-11. */
  store: Pick<CampaignStore, 'appendLog'>;
  clock?: Clock;
  random?: RandomSource;
  /** Last `seq` already used by this campaign (M0-11 passes the recovered value). Default 0. */
  initialSeq?: number;
  /** Called after an action commits, in sequence order; used for autosave (HIST-02). */
  onApplied?: (state: Campaign, seq: number) => Promise<void>;
  /** How many applied actions are kept in memory for reconnect replay (§7.1). Default 1000. */
  replayLimit?: number;
  /** How many `rng` values an action needs. No registered action uses randomness yet. */
  rngCount?: (type: string, payload: unknown) => number;
  /** Unexpected failures (reducer throw, log write). Default: console.error. */
  onError?: (error: unknown) => void;
}

/** One room per campaign (§4.2): owns the authoritative state, `seq` and the connections. */
export interface Engine extends GatewayHandler {
  readonly campaignId: string;
  readonly sessionId: string;
  state(): Campaign;
  seq(): number;
  /** Resolves once every queued connect/intent/join has been processed. */
  idle(): Promise<void>;
}

interface Applied {
  seq: number;
  before: Campaign;
  after: Campaign;
  patches: Patch[];
}

interface Member {
  conn: GatewayConnection;
  audience: Audience;
  key: string;
}

export function createEngine(options: EngineOptions): Engine {
  const clock = options.clock ?? systemClock;
  const random = options.random ?? cryptoRandom;
  const replayLimit = options.replayLimit ?? 1000;
  const rngCount = options.rngCount ?? (() => 0);
  const onError =
    options.onError ??
    ((error: unknown) => {
      console.error('[engine]', error);
    });
  const campaignId = options.campaign.id;
  const { sessionId, store } = options;

  let state = options.campaign;
  let seq = options.initialSeq ?? 0;
  /** Ring of recently applied actions, oldest first, contiguous in `seq`. */
  const history: Applied[] = [];
  const members = new Map<string, Member>();

  // All state-touching work runs one item at a time, so `seq` order equals broadcast order and a
  // connect never observes a half-applied action.
  let queue: Promise<void> = Promise.resolve();
  function serialize(task: () => Promise<void> | void): Promise<void> {
    const run = queue.then(task);
    queue = run.catch(() => undefined);
    return run;
  }

  const placeOf = (conn: GatewayConnection) => ({
    identityId: conn.identityId,
    isHost: conn.isHost,
  });

  function snapshotFor(audience: Audience): ServerMessage {
    // PERM-03: the state is filtered for the audience before it is serialized.
    return {
      t: 'snapshot',
      seq,
      state: visibleTo(audience, state),
      seatId: audience.kind === 'seat' ? audience.seatId : null,
    };
  }

  /** Patches for `entry` as `audience` sees them (hybrid translation, D21). */
  function patchMessage(audience: Audience, entry: Applied): PatchMessage {
    return {
      t: 'patch',
      seq: entry.seq,
      patches: patchesFor(audience, entry.before, entry.after, entry.patches),
    };
  }

  /**
   * Replay is possible only if every missed action is still cached and the client's state was
   * built for the audience it has now; otherwise the patches would not apply to what it holds.
   */
  function replayFrom(member: Member, lastSeq: number): Applied[] | undefined {
    if (lastSeq >= seq) return undefined; // nothing new (the client needs a state to go ready) or a future seq
    const first = history[0];
    if (!first || first.seq > lastSeq + 1) return undefined;
    const missed = history.slice(lastSeq + 1 - first.seq);
    const startState = missed[0]?.before;
    if (!startState) return undefined;
    const then = audienceKey(audienceFor(startState, placeOf(member.conn)));
    return then === member.key ? missed : undefined;
  }

  function greet(member: Member): void {
    const { lastSeq } = member.conn;
    const missed = lastSeq === undefined ? undefined : replayFrom(member, lastSeq);
    if (missed) for (const entry of missed) member.conn.send(patchMessage(member.audience, entry));
    else member.conn.send(snapshotFor(member.audience));
  }

  /** Pipeline steps 7-8 for one applied action. */
  function broadcast(entry: Applied, sender?: GatewayConnection, clientRef?: string): void {
    const groups = new Map<string, Member[]>();
    for (const member of members.values()) {
      const next = audienceFor(entry.after, placeOf(member.conn));
      const nextKey = audienceKey(next);
      if (nextKey !== member.key) {
        // Seat changes switch the view wholesale: a fresh filtered snapshot, never a patch that
        // assumes the old audience's state.
        member.audience = next;
        member.key = nextKey;
        member.conn.send(snapshotFor(next));
        continue;
      }
      const group = groups.get(nextKey);
      if (group) group.push(member);
      else groups.set(nextKey, [member]);
    }
    for (const group of groups.values()) {
      const audience = group[0]?.audience;
      if (!audience) continue;
      const message = patchMessage(audience, entry);
      // §7.4: computed and serialized once per audience; spectators all get the same bytes.
      // Every audience gets every seq, even with no patches, because clients apply strictly in order.
      const frame = encodeServerMessage(message);
      for (const member of group) {
        if (member.conn === sender && clientRef !== undefined) {
          member.conn.send({ ...message, clientRef });
        } else {
          member.conn.sendRaw(frame);
        }
      }
    }
  }

  type Outcome = { ok: true; seq: number } | { ok: false; reason: RejectReason; detail?: string };

  /** Pipeline steps 2-8 (§4.2) for one intent from `conn`. */
  async function apply(
    conn: GatewayConnection,
    type: string,
    payload: unknown,
    extra: { clientRef?: string; sceneId?: string },
  ): Promise<Outcome> {
    const actor = actorFor(state, placeOf(conn));
    const check = checkIntent(state, actor, type, payload);
    if (!check.ok) {
      // zod messages echo client input; keep the detail generic.
      return {
        ok: false,
        reason: check.reason,
        ...(check.reason === 'invalid-payload' ? { detail: 'payload does not match schema' } : {}),
      };
    }

    const ts = clock();
    const rng = randomFloats(rngCount(type, check.payload), random);
    const envelope: ActionEnvelope = {
      id: ulid(ts, random),
      type,
      payload: check.payload,
      actor,
      campaignId,
      ...(extra.sceneId !== undefined ? { sceneId: extra.sceneId } : {}),
      sessionId,
      seq: seq + 1,
      ts,
      ...(rng.length > 0 ? { rng } : {}),
      ...(extra.clientRef !== undefined ? { clientRef: extra.clientRef } : {}),
    };

    const before = state;
    try {
      const result = reduceAction(before, envelope);
      await store.appendLog(campaignId, sessionId, [
        { envelope, inversePatches: result.inversePatches },
      ]);
      // Commit only after the log append succeeded: a failed write consumes no seq.
      const entry: Applied = {
        seq: envelope.seq,
        before,
        after: result.state,
        patches: result.patches,
      };
      state = result.state;
      seq = entry.seq;
      history.push(entry);
      if (history.length > replayLimit) history.shift();
      broadcast(entry, conn, extra.clientRef);
      if (options.onApplied) {
        try {
          await options.onApplied(state, seq);
        } catch (error) {
          // The action is already logged and committed; a failed checkpoint must not reject it.
          onError(error);
        }
      }
      return { ok: true, seq: entry.seq };
    } catch (error) {
      onError(error);
      return { ok: false, reason: 'conflict', detail: 'not applied: host error' };
    }
  }

  return {
    campaignId,
    sessionId,
    state: () => state,
    seq: () => seq,
    idle: () => queue,

    onConnect(conn) {
      return serialize(() => {
        const audience = audienceFor(state, placeOf(conn));
        const member: Member = { conn, audience, key: audienceKey(audience) };
        members.set(conn.connectionId, member);
        greet(member);
      });
    },

    onIntent(conn, msg: Of<'intent'>) {
      return serialize(async () => {
        if (!members.has(conn.connectionId)) return; // disconnected while queued
        const outcome = await apply(conn, msg.type, msg.payload, {
          clientRef: msg.clientRef,
          ...(msg.sceneId !== undefined ? { sceneId: msg.sceneId } : {}),
        });
        if (outcome.ok) conn.send({ t: 'ack', clientRef: msg.clientRef, seq: outcome.seq });
        else
          conn.send({
            t: 'reject',
            clientRef: msg.clientRef,
            reason: outcome.reason,
            ...(outcome.detail !== undefined ? { detail: outcome.detail } : {}),
          });
      });
    },

    /**
     * Minimal seat claim: `join { seatId }` runs `session.join` through the normal pipeline.
     * The full join flow (seat tokens, auto-seat, session seats) is M1-06.
     */
    onJoin(conn, msg: Of<'join'>) {
      return serialize(async () => {
        if (!members.has(conn.connectionId) || msg.seatId === undefined) return;
        const outcome = await apply(
          conn,
          'session.join',
          {
            seatId: msg.seatId,
            identityId: conn.identityId,
          },
          {},
        );
        if (!outcome.ok) {
          conn.send({
            t: 'error',
            code: 'seat-unavailable',
            message: 'seat unavailable',
            fatal: false,
          });
        }
      });
    },

    // Ephemeral relay (filtered, rate-limited) is M1-07; until then ephemerals are dropped.
    onEphemeral: () => undefined,

    onDisconnect(conn) {
      members.delete(conn.connectionId);
    },
  };
}
