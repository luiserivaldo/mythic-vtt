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

/**
 * A freehand sample is a full-precision pointer hit. Three decimals of a scene unit are far finer
 * than any pointer can be aimed, and every extra digit is pure wire cost, so a sample is quantised
 * on the way into the stroke. That is what keeps a stroke inside the relay's payload cap (MV-155).
 */
export const DRAW_POINT_DECIMALS = 3;

/**
 * The largest coordinate the app can legally produce, in scene units: the elevation ceiling TOK-03
 * allows, which is far past the 200-cell canvas D37 caps a board at. A sample outside it is clamped
 * rather than allowed to grow a frame, so the worst-case stroke size below is a real bound.
 */
export const DRAW_COORD_LIMIT = 1000;

/**
 * A wire stroke is capped so its encoded frame always fits the relay's 4096-byte default. Worst
 * case at this cap: three clamped coordinates at `DRAW_POINT_DECIMALS` decimals cost under 44 bytes
 * per sample, so 64 samples plus the envelope encode to under 3 KB — asserted by a relay test that
 * relays a full-length stroke instead of dropping it.
 */
export const MAX_DRAW_POINTS = 64;

/**
 * How many raw samples one local gesture keeps. Past this the gesture is simplified for the wire
 * (`simplifyDrawPoints`) instead of being cut off, so a stroke drawn for a second still reaches
 * every other client whole.
 */
export const MAX_STROKE_SAMPLES = 512;
/** Samples closer than this are pointer noise: a still pointer must not pad the stroke. */
export const DRAW_POINT_EPSILON = 0.01;

export const DrawColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
/** `z.number()` already rejects NaN and ±Infinity in zod 4, so a bad sample never parses. */
export const DrawPoint = z.strictObject({
  x: z.number().min(-DRAW_COORD_LIMIT).max(DRAW_COORD_LIMIT),
  y: z.number().min(-DRAW_COORD_LIMIT).max(DRAW_COORD_LIMIT),
  z: z.number().min(-DRAW_COORD_LIMIT).max(DRAW_COORD_LIMIT),
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

const DRAW_QUANTUM = 10 ** DRAW_POINT_DECIMALS;

/** One coordinate, clamped to the drawing domain and rounded to the wire precision. */
function quantiseCoordinate(value: number): number {
  const clamped = Math.min(DRAW_COORD_LIMIT, Math.max(-DRAW_COORD_LIMIT, value));
  const rounded = Math.round(clamped * DRAW_QUANTUM) / DRAW_QUANTUM;
  // Rounding can land on -0. It is the same sample as 0, and JSON writes it as 0 anyway.
  return rounded === 0 ? 0 : rounded;
}

/**
 * A pointer hit as the wire and the geometry will hold it, or `null` for a sample that cannot be
 * drawn (a broken projection). This is the one place a sample is quantised and clamped, so every
 * stroke this client stores or sends satisfies `DrawStrokeData` and fits the relay's payload cap.
 */
export function normaliseDrawPoint(point: Vec3): Vec3 | null {
  if (!finiteDrawPoint(point)) return null;
  return {
    x: quantiseCoordinate(point.x),
    y: quantiseCoordinate(point.y),
    z: quantiseCoordinate(point.z),
  };
}

function sameSample(a: Vec3, b: Vec3): boolean {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz < DRAW_POINT_EPSILON * DRAW_POINT_EPSILON;
}

/**
 * Appends one freehand sample to a local gesture. A non-finite sample, a repeat of the previous
 * sample and a sample beyond MAX_STROKE_SAMPLES are all dropped; what is kept is quantised and
 * clamped. The result is a raw gesture, not a wire stroke: `simplifyDrawPoints` turns it into what
 * is drawn and sent.
 */
export function appendDrawPoint(points: readonly Vec3[], point: Vec3): readonly Vec3[] {
  const sample = normaliseDrawPoint(point);
  if (sample === null) return points;
  if (points.length >= MAX_STROKE_SAMPLES) return points;
  const last = points[points.length - 1];
  if (last !== undefined && sameSample(last, sample)) return points;
  return [...points, sample];
}

/** Perpendicular distance from `point` to the line through `from` and `to`, in scene units. */
function perpendicularDistance(point: Vec3, from: Vec3, to: Vec3): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const px = point.x - from.x;
  const py = point.y - from.y;
  const pz = point.z - from.z;
  const lengthSquared = dx * dx + dy * dy + dz * dz;
  // A segment of no length (two identical samples) degenerates to the plain distance.
  if (lengthSquared === 0) return Math.hypot(px, py, pz);
  const along = (px * dx + py * dy + pz * dz) / lengthSquared;
  return Math.hypot(px - along * dx, py - along * dy, pz - along * dz);
}

/**
 * Reduces a raw gesture to at most `max` samples for the wire and for the ribbon: a Douglas-Peucker
 * simplification that splits the sample of greatest deviation first, so the ends always survive and
 * a gesture that ran past the cap keeps its shape across its whole length instead of being cut off.
 * A segment whose every sample sits within DRAW_POINT_EPSILON of its chord is a straight run and
 * is not split at all.
 */
export function simplifyDrawPoints(points: readonly Vec3[], max: number = MAX_DRAW_POINTS): Vec3[] {
  const budget = Math.min(Math.max(0, Math.floor(max)), points.length);
  if (budget >= points.length) return [...points];
  if (budget === 0) return [];
  const first = points[0];
  if (first === undefined) return [];
  if (budget === 1) return [first];

  const kept = [0, points.length - 1];
  const segments: Array<readonly [number, number]> = [[0, points.length - 1]];
  while (kept.length < budget) {
    let bestIndex = -1;
    let bestDistance = -1;
    let bestSegment = -1;
    for (const [position, segment] of segments.entries()) {
      const [start, end] = segment;
      const from = points[start];
      const to = points[end];
      if (from === undefined || to === undefined) continue;
      for (let index = start + 1; index < end; index += 1) {
        const sample = points[index];
        if (sample === undefined) continue;
        const distance = perpendicularDistance(sample, from, to);
        if (distance > bestDistance) {
          bestDistance = distance;
          bestIndex = index;
          bestSegment = position;
        }
      }
    }
    // Nothing left to split, or every remaining run is straighter than the eye can see.
    const segment = segments[bestSegment];
    if (bestIndex === -1 || segment === undefined || bestDistance <= DRAW_POINT_EPSILON) break;
    segments.splice(bestSegment, 1, [segment[0], bestIndex], [bestIndex, segment[1]]);
    kept.push(bestIndex);
  }

  kept.sort((a, b) => a - b);
  const simplified: Vec3[] = [];
  for (const index of kept) {
    const sample = points[index];
    if (sample !== undefined) simplified.push(sample);
  }
  return simplified;
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
