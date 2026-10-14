import { encodeServerMessage, type ClientMessage, type ServerMessage } from '@mythic/protocol';
import {
  CAMERA_POSE_CHANNEL,
  canClearDrawings,
  canEraseDrawing,
  canSendCameraPose,
  canUseSceneToggle,
  checkIntent,
  drawChannelOf,
  DrawClearData,
  DrawEraseData,
  DrawStrokeData,
  parseCameraPose,
  parsePingPayload,
  PING_CHANNEL,
  seatOf,
  seesScene,
  TOGGLE_FOR_CHANNEL,
  viewEntity,
  type Actor,
  type Audience,
  type Campaign,
  type DrawChannel,
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
  | 'invalid-payload'
  | 'invalid-entity-reference'
  | 'invalid-drawing'
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

/**
 * LAY-05: how many drawings the relay remembers per scene, and how many scenes it tracks at all.
 * A session drawing more than this is throttled out of memory oldest-first; the drawings stay on
 * the board for everyone who already has them.
 */
const MAX_DRAWINGS_PER_SCENE = 512;
const MAX_DRAWING_SCENES = 64;

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

/**
 * PERM-03: does this audience see every scene a frame names? An empty set is vacuously true, so
 * channels that carry no scene (cursors) are never filtered by scene.
 */
function seesEveryScene(
  state: Campaign,
  audience: Audience,
  sceneIds: ReadonlySet<string>,
): boolean {
  for (const sceneId of sceneIds) if (!seesScene(state, audience, sceneId)) return false;
  return true;
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
 * LAY-05: the frame that finishes a drawing. The spectator delivery bucket must never drop it — a
 * short stroke may have sent nothing but its first sample, so losing the closing frame loses the
 * whole drawing for that spectator. Erasing and clearing are as final as a finished stroke, and
 * every drawing frame is already rate-limited per sender above.
 */
function isFinalDrawFrame(kind: DrawChannel, data: unknown): boolean {
  if (kind !== 'stroke') return true;
  return (
    typeof data === 'object' && data !== null && (data as { phase?: unknown }).phase === 'finished'
  );
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
    'invalid-payload': 0,
    'invalid-entity-reference': 0,
    'invalid-drawing': 0,
    'invalid-camera-pose': 0,
    forbidden: 0,
    'hidden-entity': 0,
    'hidden-scene': 0,
    'audience-filtered': 0,
  };

  const drop = (reason: EphemeralDropReason, count = 1) => {
    dropped[reason] += count;
  };

  /**
   * LAY-05: drawings are relayed live and are never campaign state, so the host remembers only
   * who drew each stroke — the minimum it needs to authorise erasing. It is bounded and in
   * memory only: a restart, an eviction or a `draw.clear` forgets the stroke, and an evicted
   * stroke is nobody's to erase. Nothing here is persisted or logged, so a client that joins late
   * or reconnects sees no existing drawings — the geometry lives only on the clients that were
   * there when it was drawn.
   */
  const drawings = new Map<string, Map<string, string>>();

  function recordStroke(sceneId: string, strokeId: string, owner: string): void {
    let strokes = drawings.get(sceneId);
    if (!strokes) {
      if (drawings.size >= MAX_DRAWING_SCENES) {
        const oldest = drawings.keys().next().value;
        if (oldest !== undefined) drawings.delete(oldest);
      }
      strokes = new Map();
      drawings.set(sceneId, strokes);
    }
    strokes.delete(strokeId);
    strokes.set(strokeId, owner);
    while (strokes.size > MAX_DRAWINGS_PER_SCENE) {
      const oldest = strokes.keys().next().value;
      if (oldest === undefined) break;
      strokes.delete(oldest);
    }
  }

  /** Runs one drawing message: `null` means it was dropped (and counted) and must not relay. */
  function applyDrawing(
    sender: GatewayConnection,
    senderAudience: Audience,
    message: EphemeralMessage,
    state: Campaign,
    actor: Actor,
    kind: DrawChannel,
  ): string | null {
    switch (kind) {
      case 'stroke': {
        // The scene toggle gate above already proved the scene exists, for every sender.
        const parsed = DrawStrokeData.safeParse(message.data);
        if (!parsed.success) {
          drop('invalid-drawing');
          return null;
        }
        const { sceneId, strokeId } = parsed.data;
        if (!seesScene(state, senderAudience, sceneId)) {
          drop('forbidden');
          return null;
        }
        const owner = drawings.get(sceneId)?.get(strokeId);
        // A client may update its own stroke while the pointer is down, but never take over a
        // stroke that is already someone else's: that would hand it the author's erase right.
        if (owner !== undefined && owner !== sender.identityId) {
          drop('forbidden');
          return null;
        }
        recordStroke(sceneId, strokeId, sender.identityId);
        return sceneId;
      }
      case 'erase': {
        const parsed = DrawEraseData.safeParse(message.data);
        if (!parsed.success) {
          drop('invalid-drawing');
          return null;
        }
        const strokes = drawings.get(parsed.data.sceneId);
        const owner = strokes?.get(parsed.data.strokeId);
        if (owner === undefined) {
          drop('invalid-drawing');
          return null;
        }
        if (!canEraseDrawing(state, actor, owner)) {
          drop('forbidden');
          return null;
        }
        strokes?.delete(parsed.data.strokeId);
        return parsed.data.sceneId;
      }
      case 'clear': {
        const parsed = DrawClearData.safeParse(message.data);
        if (!parsed.success) {
          drop('invalid-drawing');
          return null;
        }
        // Role before scene, so a refusal never tells a player which scenes exist.
        if (!canClearDrawings(state, actor)) {
          drop('forbidden');
          return null;
        }
        drawings.delete(parsed.data.sceneId);
        return parsed.data.sceneId;
      }
    }
  }

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

      // M4-14 / LAY-05: the `ping` channel is gated by a scene toggle, so the host — not only the
      // client that draws the marker — owns its shape. A strict parse keeps an arbitrary (up to the
      // payload cap) `data` blob, or a non-finite coordinate, from being fanned out to the table.
      if (message.channel === PING_CHANNEL && parsePingPayload(message.data) === null) {
        drop('invalid-payload');
        return;
      }

      // LAY-05: drawings are relayed like other tool ephemerals, but erasing and clearing are
      // authorised here — the author for one stroke, the DM or a co-DM for all of them.
      const drawing = drawChannelOf(message.channel);
      const senderAudience = audienceFor(state, sender);
      if (
        drawing !== null &&
        applyDrawing(sender, senderAudience, message, state, senderActor, drawing) === null
      )
        return;

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

      // PERM-03 / M4-14: a channel whose data names a scene (a ping's `sceneId`, a ruler's, an
      // entity reference's) may cross only between viewers who can see that scene. The toggle gate
      // above decides *whether* a sender may use the channel; this decides *who* receives it, so a
      // DM pinging, measuring or dragging on a DM-only or inactive scene never leaks its id or
      // coordinates to players or spectators. A sender must see the scene too.
      const scenesNamed = new Set<string>();
      const namedSceneId = sceneIdOf(message.data);
      if (namedSceneId !== undefined) scenesNamed.add(namedSceneId);
      for (const ref of refs) scenesNamed.add(ref.sceneId);
      // CAM-06: a pose names the scene it was taken in (the parsed `sceneId`, the same field read
      // above), so it is filtered by this one scene rule like every other scene-bearing channel.
      if (pose !== null) scenesNamed.add(pose.sceneId);
      if (!seesEveryScene(state, senderAudience, scenesNamed)) {
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

      // UI-JOIN-01: shared tool colours come from the validated connection profile, not a spoofed
      // preview. Pings carry the sender's colour too, so the marker is identifiable on every board.
      const coloredTool =
        message.channel === 'ruler.preview' ||
        message.channel === 'cursor' ||
        message.channel === PING_CHANNEL;
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
      // First by scene: a target that cannot see a scene the message names never learns the frame.
      const sceneTargets = targets.filter((target) =>
        seesEveryScene(state, target.audience, scenesNamed),
      );
      drop('hidden-scene', targets.length - sceneTargets.length);
      // Then by entity, within the scenes they can see.
      const visibleTargets = sceneTargets.filter((target) => {
        for (const ref of refs) {
          const entity = state.scenes[ref.sceneId]?.entities[ref.entityId];
          if (entity === undefined) return false;
          const seat =
            target.audience.kind === 'seat' ? state.seats[target.audience.seatId] : undefined;
          if (viewEntity(target.audience, entity, seat) === null) return false;
        }
        return true;
      });
      drop('hidden-entity', sceneTargets.length - visibleTargets.length);

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
      // LAY-05: a drawing's closing frame is never coalesced away; see `isFinalDrawFrame`.
      const finalDraw = drawing !== null && isFinalDrawFrame(drawing, message.data);
      if (spectatorTargets.length > 0 && !finalDraw) {
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
