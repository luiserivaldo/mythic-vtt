/**
 * M4-11 (CAM-06): the client half of the camera link.
 *
 * The DM's client publishes its pose on the `camera.pose` ephemeral; a player adopts an explicit
 * pull and a spectator adopts the stream while it follows. Everything here is pure so the wire
 * pose can be tested without a renderer: reading the local cameras, clamping an adopted pose to
 * the local canvas and zoom range (D37 and CAM-01/02), detecting a real move, and deciding which
 * pose a given viewer applies.
 *
 * Adopting a pose is never an action (Pillar 1): nothing here touches campaign state or the log,
 * and a pose carries board coordinates only, so it cannot leak anything visibility already hid.
 */
import type { CameraPose, CameraPose2D, CameraPose3D, CameraPoseMessage } from '@mythic/shared';
import { clampViewToBounds, clampZoom, type CanvasSize, type View2D } from './camera-2d.js';
import { clampOrbit, clampTargetToGround, type GroundBounds, type Orbit3D } from './camera-3d.js';
import type { ViewerRole } from '../ui/viewer.js';

/** Which camera a viewer owns: only a DM publishes, only a spectator can follow. */
export type CameraPoseViewer = 'dm' | 'player' | 'spectator';

/**
 * Shortest gap between two poses of a continuous stream. The host token bucket (30/s) is far
 * above this, so the throttle is what keeps a pan from flooding the table; a pull ignores it.
 */
export const POSE_SEND_INTERVAL_MS = 100;

/** Position/zoom change smaller than this is sub-pixel and not worth a frame. */
export const POSE_EPSILON = 1e-3;

/**
 * How long the DM's client may go without republishing. A spectator that has just chosen to
 * follow catches up on the next heartbeat even if the DM's camera is still (~2 s worst case).
 */
export const POSE_HEARTBEAT_MS = 2000;

/**
 * A received pose is adopted only while it is fresh: a frame that arrived during a camera-mode
 * switch and could not be applied in time is dropped rather than yanking the camera later.
 */
export const POSE_STALE_MS = 1000;

export function poseFromView2D(view: View2D): CameraPose2D {
  return { mode: '2d', centerX: view.centerX, centerZ: view.centerZ, zoom: view.zoom };
}

export function poseFromOrbit(orbit: Orbit3D): CameraPose3D {
  return { mode: '3d', ...orbit };
}

/**
 * The payload the DM publishes: the pose, the scene it was taken in and whether it is an explicit
 * pull. The scene is not optional — the host refuses a pose that cannot name one and a peer's
 * parser does too — so both halves of the wire contract agree on exactly this shape.
 */
export function cameraPoseFrame(
  pose: CameraPose,
  sceneId: string,
  pull: boolean,
): CameraPoseMessage {
  return { ...pose, sceneId, pull };
}

/** The local view for an adopted 2D pose: the local zoom range and the canvas bounds apply. */
export function viewFromPose(pose: CameraPose2D, bounds: CanvasSize): View2D {
  return clampViewToBounds(
    { centerX: pose.centerX, centerZ: pose.centerZ, zoom: clampZoom(pose.zoom) },
    bounds,
  );
}

/** The local orbit for an adopted 3D pose: every invariant of `clampOrbit` applies. */
export function orbitFromPose(pose: CameraPose3D, bounds: GroundBounds | null): Orbit3D {
  return clampOrbit(
    clampTargetToGround(
      {
        targetX: pose.targetX,
        targetY: pose.targetY,
        targetZ: pose.targetZ,
        azimuth: pose.azimuth,
        polar: pose.polar,
        distance: pose.distance,
      },
      bounds,
    ),
  );
}

const sameNumber = (a: number | undefined, b: number | undefined, epsilon: number): boolean => {
  if (a === b) return true;
  if (typeof a !== 'number' || typeof b !== 'number') return false;
  if (Number.isNaN(a) && Number.isNaN(b)) return true;
  return Math.abs(a - b) <= epsilon;
};

const POSE_KEYS = {
  '2d': ['centerX', 'centerZ', 'zoom'],
  '3d': ['targetX', 'targetY', 'targetZ', 'azimuth', 'polar', 'distance'],
} as const;

/** Would adopting `next` move the camera? A mode change always does; a NaN reading counts. */
export function poseChanged(
  previous: CameraPose | null,
  next: CameraPose,
  epsilon = POSE_EPSILON,
): boolean {
  if (previous === null || previous.mode !== next.mode) return true;
  const before = previous as unknown as Record<string, number>;
  const after = next as unknown as Record<string, number>;
  return POSE_KEYS[next.mode].some((key) => !sameNumber(before[key], after[key], epsilon));
}

/** The continuous stream's throttle: the first pose always goes out immediately. */
export function shouldSendPose(lastSentAtMs: number | null, nowMs: number): boolean {
  if (lastSentAtMs === null) return true;
  return nowMs - lastSentAtMs >= POSE_SEND_INTERVAL_MS;
}

/** The camera role a viewer has: a co-DM owns a camera as much as the host does. */
export function poseViewerOf(role: ViewerRole): CameraPoseViewer {
  if (role === 'host' || role === 'codm') return 'dm';
  return role === 'player' ? 'player' : 'spectator';
}

/**
 * Does this viewer adopt a pose the DM published? A DM never follows another DM (their own echo
 * aside, a camera they already own is not moved by a peer). A player adopts only an explicit
 * pull — "pull all players to my view" — so the DM's own camera travelling never drags a player
 * around. A spectator adopts everything, but only while it has chosen to follow the DM camera.
 */
export function acceptsCameraPose(
  message: CameraPoseMessage,
  viewer: CameraPoseViewer,
  following: boolean,
): boolean {
  if (viewer === 'dm') return false;
  if (viewer === 'player') return message.pull;
  return following;
}
