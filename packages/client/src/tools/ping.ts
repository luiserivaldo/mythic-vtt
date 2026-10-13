import {
  canUseSceneToggle,
  PING_TOGGLE,
  resolveSceneBounds,
  type Actor,
  type Campaign,
  type Scene,
  type Vec3,
} from '@mythic/shared';
import { z } from 'zod';

/**
 * LAY-05: render-local ping markers. A ping is an ephemeral message only — it never enters campaign
 * state, the action log or a save (`TECHNICAL.md` §4.3). This module is the wire shape and the
 * animation maths; the marker list lives in `ping-store.ts` and the board wiring in `PingTool`.
 */

/** How long a ping stays on the board. Short: it is an attention cue, not a note. */
export const PING_TTL_MS = 1_500;

/** Marker radii in scene units (1 unit = 1 grid cell). A ping grows to about one cell across. */
export const PING_START_RADIUS = 0.18;
export const PING_END_RADIUS = 1.5;

/** Markers kept at once; a burst beyond this only costs the oldest one, never the frame rate. */
export const MAX_ACTIVE_PINGS = 64;

/**
 * The relayed ping payload. There is no protocol schema for this channel yet, so the client
 * validates the boundary itself. `color` is added by the host from the sender's validated
 * connection profile (UI-JOIN-01), so a spoofed colour never reaches a peer.
 */
export const PingPayload = z.strictObject({
  sceneId: z.string().min(1).max(64),
  x: z.number(),
  y: z.number(),
  z: z.number(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});
export type PingPayload = z.infer<typeof PingPayload>;

/** LAY-05: the outgoing payload for a ping at a scene point. */
export function pingPayload(sceneId: string, point: Vec3): PingPayload {
  return { sceneId, x: point.x, y: point.y, z: point.z };
}

export interface PingViewer {
  readonly isHost: boolean;
  readonly seatId: string | null;
}

/**
 * PERM-05: who may ping, from the client's own filtered view. The host and co-DMs are exempt; a
 * player needs the scene's `pins` toggle AND their seat's Enable Interaction switch. Spectators
 * (no seat), unknown scenes and a client that has not loaded a campaign may not ping. The host
 * re-checks all of this in the relay, so this only decides whether the marker is offered at all.
 */
export function canPing(
  campaign: Campaign | null,
  viewer: PingViewer,
  sceneId: string | null,
): boolean {
  if (!campaign || !sceneId || campaign.scenes[sceneId] === undefined) return false;
  const actor: Actor = viewer.isHost
    ? { kind: 'host' }
    : viewer.seatId !== null
      ? { kind: 'seat', seatId: viewer.seatId }
      : { kind: 'seat' };
  return canUseSceneToggle(campaign, actor, sceneId, PING_TOGGLE);
}

/**
 * A ping lands on the ground plane wherever the ray hits it, clamped to the scene canvas. Unlike a
 * ruler waypoint it is *not* snapped: the point of a ping is the exact spot the sender meant. A
 * non-finite hit (a camera looking along the plane) is refused instead of clamped, which would
 * otherwise pin every such ping to a board corner.
 */
export function pingPoint(raw: Pick<Vec3, 'x' | 'z'>, scene: Pick<Scene, 'bounds'>): Vec3 | null {
  if (!Number.isFinite(raw.x) || !Number.isFinite(raw.z)) return null;
  const bounds = resolveSceneBounds(scene);
  return {
    x: Math.min(Math.max(raw.x, 0), bounds.width),
    y: 0,
    z: Math.min(Math.max(raw.z, 0), bounds.height),
  };
}

export interface PingMarker {
  /** Monotonic local id, so React can key a burst of markers from the same sender. */
  readonly key: number;
  /** Sender identity, as stamped by the host relay. */
  readonly from: string;
  readonly sceneId: string;
  /** Local clock reading when the marker appeared; the animation and its expiry both use it. */
  readonly at: number;
  readonly point: Vec3;
  readonly color?: string;
}

/** True once the marker has lived its full life; the caller drops it. */
export function pingExpired(marker: Pick<PingMarker, 'at'>, nowMs: number): boolean {
  return nowMs - marker.at >= PING_TTL_MS;
}

/**
 * 0 at spawn, 1 at the end of life; ±Infinity clamps to the nearest end. `NaN` (no reading) counts
 * as just spawned, matching `rulerExpired`, so a marker is never dropped on a bad clock sample.
 */
export function pingProgress(ageMs: number): number {
  if (Number.isNaN(ageMs) || ageMs <= 0) return 0;
  if (ageMs >= PING_TTL_MS) return 1;
  return ageMs / PING_TTL_MS;
}

export interface PingVisual {
  readonly radius: number;
  readonly opacity: number;
}

/**
 * The marker at a given progress: a ring expanding from the spawn radius to the end radius while it
 * fades. With reduced motion it stays a fixed-size ring and only fades, so the cue still reads
 * without movement (the camera tweens do the same, see `use-view-director`).
 */
export function pingVisual(progress: number, reducedMotion = false): PingVisual {
  const p = Number.isNaN(progress) ? 0 : Math.min(1, Math.max(0, progress));
  return {
    radius: reducedMotion
      ? PING_END_RADIUS
      : PING_START_RADIUS + (PING_END_RADIUS - PING_START_RADIUS) * p,
    opacity: 1 - p,
  };
}
