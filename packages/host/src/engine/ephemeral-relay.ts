import { encodeServerMessage, type ClientMessage, type ServerMessage } from '@mythic/protocol';
import {
  CAMERA_POSE_CHANNEL,
  canSendCameraPose,
  canUseSceneToggle,
  checkIntent,
  parseCameraPose,
  seatOf,
  seesScene,
  TOGGLE_FOR_CHANNEL,
  viewEntity,
  type Audience,
  type Campaign,
} from '@mythic/shared';
import type { GatewayConnection } from '../gateway/engine-seam.js';
import { actorFor, audienceFor } from './audience.js';
import type { Clock } from './sources.js';

type EphemeralMessage = Extract<ClientMessage, { t: 'ephemeral' }>;
type RelayedEphemeral = Extract<ServerMessage, { t: 'ephemeral' }>;

export interface TokenBucketConfig {
  readonly ratePerSecond: number;
  readonly burst: number;
}

export interface EphemeralRelayOptions {
  /** Maximum encoded host-to-client frame size. Default 4096 bytes. */
  readonly maxPayloadBytes?: number;
  /** Per-connection rate for host, co-DM and player senders. */
  readonly activeRate?: Partial<TokenBucketConfig>;
  /** Per-connection rate for unseated/spectator senders. */
  readonly spectatorRate?: Partial<TokenBucketConfig>;
  /** Shared spectator audience fan-out rate. */
  readonly spectatorDeliveryRate?: Partial<TokenBucketConfig>;
  /**
   * CAM-06: spectator fan-out rate for the camera-pose stream alone. A DM moving the camera
   * publishes at 10/s, which would spend the whole shared spectator budget and drop every ruler,
   * drag preview and cursor to spectators; the pose channel therefore has its own.
   */
  readonly cameraPoseDeliveryRate?: Partial<TokenBucketConfig>;
}

export type EphemeralDropReason =
  | 'rate-limited'
  | 'spectator-rate-limited'
  | 'payload-too-large'
  | 'invalid-entity-reference'
  | 'invalid-camera-pose'
  | 'forbidden'
  | 'hidden-entity'
  | 'hidden-scene'
  | 'audience-filtered';

export interface EphemeralRelayStats {
  readonly relayed: number;
  readonly dropped: Readonly<Record<EphemeralDropReason, number>>;
}

export interface EphemeralRecipient {
  readonly conn: GatewayConnection;
  readonly audience: Audience;
}

const isSpectatorTarget = (target: EphemeralRecipient): boolean =>
  target.audience.kind === 'spectators' || target.conn.isSpectator === true;

export interface EphemeralRelay {
  relay(
    sender: GatewayConnection,
    message: EphemeralMessage,
    state: Campaign,
    recipients: Iterable<EphemeralRecipient>,
  ): void;
  disconnect(connectionId: string): void;
  stats(): EphemeralRelayStats;
}

const DEFAULT_ACTIVE_RATE: TokenBucketConfig = { ratePerSecond: 30, burst: 60 };
const DEFAULT_SPECTATOR_RATE: TokenBucketConfig = { ratePerSecond: 5, burst: 10 };
const DEFAULT_SPECTATOR_DELIVERY_RATE: TokenBucketConfig = { ratePerSecond: 10, burst: 10 };
/**
 * CAM-06: the pose stream is published at 10/s (the client's own throttle), plus a slow heartbeat,
 * so its own spectator budget has to sit just above that. Keeping it separate is the point: a DM
 * panning must never spend the shared spectator budget that rulers, cursors and drag previews fan
 * out through.
 */
const DEFAULT_CAMERA_POSE_DELIVERY_RATE: TokenBucketConfig = { ratePerSecond: 15, burst: 15 };

class TokenBucket {
  private tokens: number;
  private lastMs: number;

  constructor(
    private readonly config: TokenBucketConfig,
    nowMs: number,
  ) {
    this.tokens = config.burst;
    this.lastMs = nowMs;
  }

  take(nowMs: number): boolean {
    const elapsed = Math.max(0, nowMs - this.lastMs);
    this.tokens = Math.min(
      this.config.burst,
      this.tokens + (elapsed * this.config.ratePerSecond) / 1000,
    );
    this.lastMs = nowMs;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

interface EntityReference {
  readonly sceneId: string;
  readonly entityId: string;
}

function entityReferences(data: unknown): EntityReference[] | undefined {
  const found: EntityReference[] = [];
  const visit = (value: unknown, inheritedSceneId?: string): boolean => {
    if (value === null || typeof value !== 'object') return true;
    if (Array.isArray(value)) return value.every((item) => visit(item, inheritedSceneId));

    const record = value as Record<string, unknown>;
    const sceneId = typeof record.sceneId === 'string' ? record.sceneId : inheritedSceneId;
    if (Object.hasOwn(record, 'entityId')) {
      if (typeof record.entityId !== 'string' || sceneId === undefined) return false;
      found.push({ sceneId, entityId: record.entityId });
    }
    return Object.values(record).every((item) => visit(item, sceneId));
  };
  return visit(data) ? found : undefined;
}

function sceneIdOf(data: unknown): string | undefined {
  if (data === null || typeof data !== 'object') return undefined;
  const sceneId = (data as { sceneId?: unknown }).sceneId;
  return typeof sceneId === 'string' ? sceneId : undefined;
}

function rate(
  defaults: TokenBucketConfig,
  override?: Partial<TokenBucketConfig>,
): TokenBucketConfig {
  const config = { ...defaults, ...override };
  if (!Number.isFinite(config.ratePerSecond) || config.ratePerSecond <= 0) {
    throw new Error('ephemeral ratePerSecond must be positive');
  }
  if (!Number.isFinite(config.burst) || config.burst < 1) {
    throw new Error('ephemeral burst must be at least 1');
  }
  return config;
}

/**
 * Host-side, non-durable ephemeral path. It owns no campaign state and never calls storage.
 * Sender identity is always replaced from the authenticated connection.
 */
export function createEphemeralRelay(
  clock: Clock,
  options: EphemeralRelayOptions = {},
): EphemeralRelay {
  const maxPayloadBytes = options.maxPayloadBytes ?? 4096;
  if (!Number.isSafeInteger(maxPayloadBytes) || maxPayloadBytes < 256) {
    throw new Error('ephemeral maxPayloadBytes must be an integer of at least 256');
  }
  const activeRate = rate(DEFAULT_ACTIVE_RATE, options.activeRate);
  const spectatorRate = rate(DEFAULT_SPECTATOR_RATE, options.spectatorRate);
  const spectatorDeliveryRate = rate(
    DEFAULT_SPECTATOR_DELIVERY_RATE,
    options.spectatorDeliveryRate,
  );
  const cameraPoseDeliveryRate = rate(
    DEFAULT_CAMERA_POSE_DELIVERY_RATE,
    options.cameraPoseDeliveryRate,
  );
  const senders = new Map<
    string,
    { readonly kind: 'active' | 'spectator'; readonly bucket: TokenBucket }
  >();
  let spectatorDelivery: TokenBucket | undefined;
  let cameraPoseDelivery: TokenBucket | undefined;
  let relayed = 0;
  const dropped: Record<EphemeralDropReason, number> = {
    'rate-limited': 0,
    'spectator-rate-limited': 0,
    'payload-too-large': 0,
    'invalid-entity-reference': 0,
    'invalid-camera-pose': 0,
    forbidden: 0,
    'hidden-entity': 0,
    'hidden-scene': 0,
    'audience-filtered': 0,
  };

  const drop = (reason: EphemeralDropReason, count = 1) => {
    dropped[reason] += count;
  };

  return {
    relay(sender, message, state, recipients) {
      const now = clock();
      const senderActor = actorFor(state, sender);
      // UI-SEAT-05: tool previews, rulers and pings cannot bypass the durable gate.
      if (seatOf(state, senderActor)?.interactionEnabled === false) {
        drop('forbidden');
        return;
      }
      // PERM-05: scene toggles gate the channel (host and co-DM exempt, see canUseSceneToggle).
      const toggle = TOGGLE_FOR_CHANNEL[message.channel];
      if (toggle !== undefined) {
        const sceneId = sceneIdOf(message.data);
        if (sceneId === undefined || !canUseSceneToggle(state, senderActor, sceneId, toggle)) {
          drop('forbidden');
          return;
        }
      }
      // CAM-06: only the DM (or an enabled co-DM) may move everyone else's camera. The pose is
      // parsed here with the same contract a receiving client parses it with, so a malformed frame
      // is never fanned out, and it has to name the scene it was taken in so it can be filtered
      // per audience below.
      const pose = message.channel === CAMERA_POSE_CHANNEL ? parseCameraPose(message.data) : null;
      if (message.channel === CAMERA_POSE_CHANNEL) {
        if (!canSendCameraPose(state, senderActor)) {
          drop('forbidden');
          return;
        }
        if (pose === null) {
          drop('invalid-camera-pose');
          return;
        }
      }
      const kind =
        senderActor.seatId === undefined && senderActor.kind !== 'host' ? 'spectator' : 'active';
      let senderLimit = senders.get(sender.connectionId);
      if (senderLimit?.kind !== kind) {
        senderLimit = {
          kind,
          bucket: new TokenBucket(kind === 'spectator' ? spectatorRate : activeRate, now),
        };
        senders.set(sender.connectionId, senderLimit);
      }
      if (!senderLimit.bucket.take(now)) {
        drop('rate-limited');
        return;
      }

      const refs = entityReferences(message.data);
      if (refs === undefined) {
        drop('invalid-entity-reference');
        return;
      }
      for (const ref of refs) {
        if (state.scenes[ref.sceneId]?.entities[ref.entityId] === undefined) {
          drop('invalid-entity-reference');
          return;
        }
      }

      const senderAudience = audienceFor(state, sender);
      const senderSeat =
        senderAudience.kind === 'seat' ? state.seats[senderAudience.seatId] : undefined;
      if (
        refs.some((ref) => {
          const entity = state.scenes[ref.sceneId]?.entities[ref.entityId];
          return entity === undefined || viewEntity(senderAudience, entity, senderSeat) === null;
        })
      ) {
        drop('forbidden');
        return;
      }

      if (message.channel === 'token.drag-preview') {
        const check = checkIntent(state, senderActor, 'token.move', message.data);
        if (!check.ok) {
          drop('forbidden');
          return;
        }
      }

      // UI-JOIN-01: shared tool colours come from the validated connection profile, not a spoofed preview.
      const coloredTool = message.channel === 'ruler.preview' || message.channel === 'cursor';
      const data =
        coloredTool &&
        sender.color !== undefined &&
        typeof message.data === 'object' &&
        message.data !== null &&
        !Array.isArray(message.data)
          ? { ...message.data, color: sender.color }
          : message.data;
      const relayedMessage: RelayedEphemeral = { ...message, data, from: sender.identityId };
      let frame: string;
      try {
        frame = encodeServerMessage(relayedMessage);
      } catch {
        drop('payload-too-large');
        return;
      }
      if (Buffer.byteLength(frame, 'utf8') > maxPayloadBytes) {
        drop('payload-too-large');
        return;
      }

      const targets = Array.from(recipients);
      // CAM-06 / PERM-03: a pose names the scene it was taken in, so a target that cannot see that
      // scene makes no sense of it and never receives it. `seesScene` is the campaign snapshot's own
      // `visibleTo` rule, not a second copy of it.
      const sceneVisible =
        pose === null
          ? targets
          : targets.filter((target) => seesScene(state, target.audience, pose.sceneId));
      drop('hidden-scene', targets.length - sceneVisible.length);

      const visibleTargets = sceneVisible.filter((target) => {
        for (const ref of refs) {
          const entity = state.scenes[ref.sceneId]?.entities[ref.entityId];
          if (entity === undefined) return false;
          const seat =
            target.audience.kind === 'seat' ? state.seats[target.audience.seatId] : undefined;
          if (viewEntity(target.audience, entity, seat) === null) return false;
        }
        return true;
      });
      drop('hidden-entity', sceneVisible.length - visibleTargets.length);

      // CAM-06: an ordinary pose is the DM's own camera moving, not an instruction to anyone. Only
      // a spectator that chose to follow uses it, so it is never handed to a player — where the DM
      // is looking is the DM's own business, at 10 frames a second. A pull is the DM's explicit
      // "everyone, look here" and is addressed to players and spectators alike.
      const addressed =
        pose === null || pose.pull ? visibleTargets : visibleTargets.filter(isSpectatorTarget);
      drop('audience-filtered', visibleTargets.length - addressed.length);

      // M4-02: a spectator watching through a seat has a seat audience but is still a spectator.
      const spectatorTargets = addressed.filter(isSpectatorTarget);
      let sendToSpectators = true;
      if (spectatorTargets.length > 0) {
        // CAM-06: camera poses spend their own budget, so the stream they carry cannot starve the
        // shared one that every other ephemeral fans out through.
        const delivery =
          pose === null
            ? (spectatorDelivery ??= new TokenBucket(spectatorDeliveryRate, now))
            : (cameraPoseDelivery ??= new TokenBucket(cameraPoseDeliveryRate, now));
        sendToSpectators = delivery.take(now);
        if (!sendToSpectators) drop('spectator-rate-limited', spectatorTargets.length);
      }

      for (const target of addressed) {
        if (isSpectatorTarget(target) && !sendToSpectators) continue;
        target.conn.sendRaw(frame);
        relayed += 1;
      }
    },
    disconnect(connectionId) {
      senders.delete(connectionId);
    },
    stats: () => ({ relayed, dropped: { ...dropped } }),
  };
}
