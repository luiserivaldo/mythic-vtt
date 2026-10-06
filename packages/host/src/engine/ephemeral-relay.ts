import { encodeServerMessage, type ClientMessage, type ServerMessage } from '@mythic/protocol';
import { checkIntent, viewEntity, type Audience, type Campaign } from '@mythic/shared';
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
}

export type EphemeralDropReason =
  | 'rate-limited'
  | 'spectator-rate-limited'
  | 'payload-too-large'
  | 'invalid-entity-reference'
  | 'forbidden'
  | 'hidden-entity';

export interface EphemeralRelayStats {
  readonly relayed: number;
  readonly dropped: Readonly<Record<EphemeralDropReason, number>>;
}

export interface EphemeralRecipient {
  readonly conn: GatewayConnection;
  readonly audience: Audience;
}

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
  const senders = new Map<
    string,
    { readonly kind: 'active' | 'spectator'; readonly bucket: TokenBucket }
  >();
  let spectatorDelivery: TokenBucket | undefined;
  let relayed = 0;
  const dropped: Record<EphemeralDropReason, number> = {
    'rate-limited': 0,
    'spectator-rate-limited': 0,
    'payload-too-large': 0,
    'invalid-entity-reference': 0,
    forbidden: 0,
    'hidden-entity': 0,
  };

  const drop = (reason: EphemeralDropReason, count = 1) => {
    dropped[reason] += count;
  };

  return {
    relay(sender, message, state, recipients) {
      const now = clock();
      const senderActor = actorFor(state, sender);
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

      const relayedMessage: RelayedEphemeral = { ...message, from: sender.identityId };
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
      const visibleTargets = targets.filter((target) => {
        for (const ref of refs) {
          const entity = state.scenes[ref.sceneId]?.entities[ref.entityId];
          if (entity === undefined) return false;
          const seat =
            target.audience.kind === 'seat' ? state.seats[target.audience.seatId] : undefined;
          if (viewEntity(target.audience, entity, seat) === null) return false;
        }
        return true;
      });
      drop('hidden-entity', targets.length - visibleTargets.length);

      const spectatorTargets = visibleTargets.filter(
        (target) => target.audience.kind === 'spectators',
      );
      let sendToSpectators = true;
      if (spectatorTargets.length > 0) {
        spectatorDelivery ??= new TokenBucket(spectatorDeliveryRate, now);
        sendToSpectators = spectatorDelivery.take(now);
        if (!sendToSpectators) drop('spectator-rate-limited', spectatorTargets.length);
      }

      for (const target of visibleTargets) {
        if (target.audience.kind === 'spectators' && !sendToSpectators) continue;
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
