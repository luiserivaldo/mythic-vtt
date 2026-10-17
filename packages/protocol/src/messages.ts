import { z } from 'zod';
import { Ulid, WirePatch } from './common.js';
import { PROTOCOL_VERSION } from './version.js';

// One WebSocket per client, JSON messages, discriminated by `t`.

export const PlayerColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

// ---------- client -> host ----------

/** The `hello` fields without the cross-field rule, for `.pick` (zod refuses picks on refined objects). */
export const HelloFields = z.strictObject({
  t: z.literal('hello'),
  v: z.number().int().positive(),
  identityId: Ulid,
  identitySecret: z.string().min(1),
  displayName: z.string().trim().min(1).max(80),
  color: PlayerColor.optional(),
  /** M1-11: small image data URL, or a short emoji/initial; capped so a hello stays small. */
  avatar: z.string().max(32_768).optional(),
  /** Last `seq` the client applied, for replay or a fresh snapshot on reconnect. */
  lastSeq: z.number().int().nonnegative().optional(),
  /**
   * D24: one-time host token from the DM link fragment (`#host=<token>`). Present only on the
   * hello that claims host authority; additive, so the protocol version is unchanged.
   */
  hostToken: z.string().min(1).max(256).optional(),
  /**
   * D46 / MV-280: declares a spectator before presence is published, so the DM roster never lists
   * this connection as unseated. Same rules as `join {as:'spectator'}`; excludes `hostToken`.
   */
  as: z.enum(['spectator']).optional(),
});

/** First message on a connection (SES-02). The secret is hashed by the host on first contact. */
export const Hello = HelloFields.superRefine((hello, context) => {
  if (hello.as !== undefined && hello.hostToken !== undefined)
    context.addIssue({ code: 'custom', path: ['as'], message: 'as excludes hostToken' });
});

/** Sit down / start a session: claim a seat, or join as a spectator when no seat is named. */
export const Join = z
  .strictObject({
    t: z.literal('join'),
    seatId: Ulid.optional(),
    seatToken: z.string().optional(),
    spectatorToken: z.string().optional(),
    /**
     * UX-44 / UI-JOIN-01: `temporary` makes a session-only seat named `label`; `spectator` marks
     * this connection a spectator, which the host only counts (it keeps no name or avatar for it).
     */
    as: z.enum(['temporary', 'spectator']).optional(),
    label: z.string().trim().min(1).max(80).optional(),
  })
  .superRefine((join, context) => {
    const issue = (message: string) => {
      context.addIssue({ code: 'custom', path: ['as'], message });
    };
    if (join.as === undefined) {
      if (join.label !== undefined) issue('label needs as=temporary');
      return;
    }
    if (join.seatId !== undefined || join.seatToken !== undefined)
      issue('as excludes seatId and seatToken');
    if (join.as === 'temporary' && join.label === undefined) issue('temporary needs a label');
    if (join.as === 'spectator' && join.label !== undefined) issue('spectators carry no label');
  });

export const Intent = z.strictObject({
  t: z.literal('intent'),
  type: z.string().min(1),
  payload: z.unknown(),
  /** Correlates the ack/reject; unique per client connection. */
  clientRef: z.string().min(1),
  sceneId: Ulid.optional(),
});

/** TOK-02 live token position while dragging; dropping commits one durable `token.move`. */
export const TokenDragPreview = z.strictObject({
  t: z.literal('ephemeral'),
  channel: z.literal('token.drag-preview'),
  data: z.strictObject({
    sceneId: Ulid,
    entityId: Ulid,
    to: z.strictObject({ x: z.number(), y: z.number(), z: z.number() }),
  }),
  /** Set by the host when relaying; clients omit it. */
  from: Ulid.optional(),
});
export type TokenDragPreview = z.infer<typeof TokenDragPreview>;

const RulerPoint = z.strictObject({ x: z.number(), y: z.number(), z: z.number() });

/** MEAS-01 live ruler path. It is relayed only and never enters campaign state or the action log. */
export const RulerPreview = z.strictObject({
  t: z.literal('ephemeral'),
  channel: z.literal('ruler.preview'),
  data: z.strictObject({
    sceneId: Ulid,
    points: z.array(RulerPoint).max(64),
    phase: z.enum(['active', 'finished', 'cancelled']),
    color: PlayerColor.optional(),
  }),
  /** Set by the host when relaying; clients omit it. */
  from: Ulid.optional(),
});
export type RulerPreview = z.infer<typeof RulerPreview>;

/** Ephemeral (not logged, not persisted; §4.3): cursors, pings, drag previews, live rulers. */
export const Ephemeral = z
  .strictObject({
    t: z.literal('ephemeral'),
    channel: z.string().min(1),
    data: z.unknown(),
    /** Set by the host when relaying; ignored if a client supplies it. */
    from: Ulid.optional(),
  })
  .superRefine((message, context) => {
    const schema =
      message.channel === 'token.drag-preview'
        ? TokenDragPreview
        : message.channel === 'ruler.preview'
          ? RulerPreview
          : null;
    if (!schema) return;
    const parsed = schema.safeParse(message);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        context.addIssue({ code: 'custom', path: issue.path, message: issue.message });
      }
    }
  });

export const Ping = z.strictObject({ t: z.literal('ping'), n: z.number().int().nonnegative() });

export const ClientMessage = z.discriminatedUnion('t', [Hello, Join, Intent, Ephemeral, Ping]);
export type ClientMessage = z.infer<typeof ClientMessage>;

// ---------- host -> client ----------

/** Full, already-filtered state (PERM-03). `state` is validated by the client with shared schemas. */
export const Snapshot = z.strictObject({
  t: z.literal('snapshot'),
  seq: z.number().int().nonnegative(),
  state: z.unknown(),
  /** Which audience this view is for, so the client can render its own seat. */
  seatId: Ulid.nullable(),
});

export const Patch = z.strictObject({
  t: z.literal('patch'),
  seq: z.number().int().nonnegative(),
  patches: z.array(WirePatch),
  /** Present when the patch resulted from an action the receiver submitted. */
  clientRef: z.string().optional(),
});

export const Ack = z.strictObject({
  t: z.literal('ack'),
  clientRef: z.string().min(1),
  seq: z.number().int().nonnegative(),
});

export const Reject = z.strictObject({
  t: z.literal('reject'),
  clientRef: z.string().min(1),
  reason: z.enum(['unknown-action', 'invalid-payload', 'forbidden', 'rate-limited', 'conflict']),
  detail: z.string().optional(),
});

export const Presence = z.strictObject({
  t: z.literal('presence'),
  seats: z.array(
    z.strictObject({
      seatId: Ulid,
      displayName: z.string().optional(),
      color: PlayerColor.optional(),
      connected: z.boolean(),
      /** UX-06: host-measured RTT; null before the first sample or while offline. */
      latencyMs: z.number().int().min(0).max(30_000).nullable(),
    }),
  ),
  spectators: z.number().int().nonnegative(),
  /**
   * M1-11, additive: connected identities that hold no seat, so the DM can seat them (`seat.assign`).
   * Sent to the host only, never to players or spectators (PERM-03: identity ids stay private).
   */
  unseated: z
    .array(
      z.strictObject({
        identityId: Ulid,
        displayName: z.string(),
        color: PlayerColor.optional(),
        avatar: z.string().max(32_768).optional(),
      }),
    )
    .optional(),
});

export const Pong = z.strictObject({ t: z.literal('pong'), n: z.number().int().nonnegative() });

/** Non-fatal information, e.g. quota warnings. */
export const Notice = z.strictObject({
  t: z.literal('notice'),
  level: z.enum(['info', 'warning']),
  code: z.string().min(1),
  message: z.string(),
});

export const ErrorMessage = z.strictObject({
  t: z.literal('error'),
  code: z.enum([
    'protocol-mismatch',
    'bad-message',
    'unauthorized',
    'seat-unavailable',
    'server-error',
  ]),
  message: z.string(),
  /** Set on `protocol-mismatch` so the client can show a clear upgrade message. */
  supportedVersion: z.number().int().positive().optional(),
  fatal: z.boolean(),
});

export const ServerMessage = z.discriminatedUnion('t', [
  Snapshot,
  Patch,
  Ack,
  Reject,
  // Relayed ephemeral and presence share shapes with the client side where applicable.
  Ephemeral,
  Presence,
  Pong,
  Notice,
  ErrorMessage,
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

export type HelloMessage = z.infer<typeof Hello>;

export function isSupportedVersion(v: number): boolean {
  return v === PROTOCOL_VERSION;
}
