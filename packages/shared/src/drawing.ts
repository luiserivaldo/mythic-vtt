import { z } from 'zod';
import { isCoDm, isHost } from './actions/define.js';
import type { Actor } from './actions/envelope.js';
import { Id } from './schema/ids.js';
import type { Campaign } from './schema/campaign.js';
import type { Vec3 } from './schema/math.js';

// LAY-05: freehand drawings live on the effects layer. They travel as ephemerals — relayed live,
// never logged and never part of campaign state (TECHNICAL §4.3, D15) — so the same module can be
// used by the host (enforcement) and the client (payload parsing) without touching the schema,
// the migration chain or the protocol package. MV-155.

export const DRAW_STROKE_CHANNEL = 'draw.stroke';
export const DRAW_ERASE_CHANNEL = 'draw.erase';
export const DRAW_CLEAR_CHANNEL = 'draw.clear';

/** The drawing operations an ephemeral channel can carry. */
export type DrawChannel = 'stroke' | 'erase' | 'clear';

/** Which drawing operation a wire channel names, or null for every other ephemeral channel. */
export function drawChannelOf(channel: string): DrawChannel | null {
  switch (channel) {
    case DRAW_STROKE_CHANNEL:
      return 'stroke';
    case DRAW_ERASE_CHANNEL:
      return 'erase';
    case DRAW_CLEAR_CHANNEL:
      return 'clear';
    default:
      return null;
  }
}

/** UI-DOCK-01 colours: a fixed palette, so a player's own choice stays readable on any board. */
export const DRAW_COLORS = [
  '#e11d48',
  '#f59e0b',
  '#22c55e',
  '#3b82f6',
  '#a855f7',
  '#f8fafc',
] as const;

export const DEFAULT_DRAW_COLOR: string = '#e11d48';

/**
 * Widths are scene units (cells), not pixels, so a drawing keeps its thickness when the camera
 * zooms or toggles between 2D and 3D. The ceiling stops one stroke covering a whole board.
 */
export const DRAW_WIDTH_MIN = 0.02;
export const DRAW_WIDTH_MAX = 1;
export const DEFAULT_DRAW_WIDTH = 0.12;

/** One drag is capped, so a stuck pointer cannot grow one payload without bound. */
export const MAX_DRAW_POINTS = 512;
/** Samples closer than this are pointer noise: a still pointer must not pad the stroke. */
export const DRAW_POINT_EPSILON = 0.01;

export const DrawColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
/** `z.number()` already rejects NaN and ±Infinity in zod 4, so a bad sample never parses. */
export const DrawPoint = z.strictObject({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

export const DrawStrokeData = z.strictObject({
  sceneId: Id,
  strokeId: Id,
  color: DrawColor,
  width: z.number().min(DRAW_WIDTH_MIN).max(DRAW_WIDTH_MAX),
  /** `active` while the pointer is down, then one `finished` message keeps the stroke on the board. */
  phase: z.enum(['active', 'finished']),
  points: z.array(DrawPoint).min(1).max(MAX_DRAW_POINTS),
});
export type DrawStrokeData = z.infer<typeof DrawStrokeData>;

export const DrawEraseData = z.strictObject({ sceneId: Id, strokeId: Id });
export type DrawEraseData = z.infer<typeof DrawEraseData>;

export const DrawClearData = z.strictObject({ sceneId: Id });
export type DrawClearData = z.infer<typeof DrawClearData>;

/** A width from the wire or the UI, clamped into the range the stroke schema accepts. */
export function clampDrawWidth(width: number): number {
  // A non-finite slider value is a UI bug, not a request to draw at the minimum.
  if (!Number.isFinite(width)) return DEFAULT_DRAW_WIDTH;
  return Math.min(DRAW_WIDTH_MAX, Math.max(DRAW_WIDTH_MIN, width));
}

export function isDrawColor(color: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(color);
}

export function finiteDrawPoint(point: Vec3): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z);
}

function sameSample(a: Vec3, b: Vec3): boolean {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz < DRAW_POINT_EPSILON * DRAW_POINT_EPSILON;
}

/**
 * Appends one freehand sample. A non-finite sample, a repeat of the previous sample and a sample
 * beyond MAX_DRAW_POINTS are all dropped, so the wire payload always satisfies `DrawStrokeData`.
 */
export function appendDrawPoint(points: readonly Vec3[], point: Vec3): readonly Vec3[] {
  if (!finiteDrawPoint(point)) return points;
  if (points.length >= MAX_DRAW_POINTS) return points;
  const last = points[points.length - 1];
  if (last !== undefined && sameSample(last, point)) return points;
  return [...points, point];
}

/**
 * Who may erase one drawing: its author (identity, so a reconnect keeps the right), or the DM and
 * co-DMs, who may erase any drawing. An unknown author is nobody's to erase. The host runs this on
 * every erase; a client only ever shows the affordance for what it may erase.
 */
export function canEraseDrawing(state: Campaign, actor: Actor, owner: string | undefined): boolean {
  if (isHost(actor)) return true;
  if (owner === undefined) return false;
  if (isCoDm(state, actor)) return true;
  return actor.kind === 'seat' && actor.identityId === owner;
}

/** LAY-05: "the DM can clear all" — the host and co-DMs only, never a player or spectator. */
export function canClearDrawings(state: Campaign, actor: Actor): boolean {
  return isHost(actor) || isCoDm(state, actor);
}
