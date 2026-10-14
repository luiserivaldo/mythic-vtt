/**
 * M4-11 (CAM-06): the camera pose that travels as an ephemeral frame.
 *
 * A camera is per-client view state (Pillar 1), so a pose is never an action and is never
 * persisted. The DM's client sends it on the `camera.pose` channel and the host relays it; this
 * module is the one wire contract both sides share, plus the rule for who may send.
 *
 * The payload is deliberately flat — `mode` selects which fields exist — so the host can read it
 * without knowing either camera's maths. `centerX`/`centerZ`/`zoom` describe the 2D orthographic
 * view; `targetX`/`targetY`/`targetZ`/`azimuth`/`polar`/`distance` describe the 3D orbit. Both
 * camera models live in the client (`render/camera-2d.ts`, `render/camera-3d.ts`), which clamps an
 * adopted pose to the local canvas before it is applied.
 */
import { isHost, seatOf } from './actions/define.js';
import type { Actor } from './actions/envelope.js';
import type { Campaign } from './schema/index.js';

/** Ephemeral channel carrying the DM's camera pose (CAM-06). */
export const CAMERA_POSE_CHANNEL = 'camera.pose';

/** The 2D orthographic view: world X/Z at the viewport centre, zoom in pixels per grid cell. */
export interface CameraPose2D {
  readonly mode: '2d';
  readonly centerX: number;
  readonly centerZ: number;
  readonly zoom: number;
}

/** The 3D orbit: focus point on or above the ground, then azimuth/polar/distance around it. */
export interface CameraPose3D {
  readonly mode: '3d';
  readonly targetX: number;
  readonly targetY: number;
  readonly targetZ: number;
  readonly azimuth: number;
  readonly polar: number;
  readonly distance: number;
}

export type CameraPose = CameraPose2D | CameraPose3D;

/**
 * A parsed pose frame. `sceneId` is the scene the camera was looking at, so the host never hands a
 * pose from a scene a target cannot see to that target; `pull` marks the DM's explicit "pull
 * everyone to my view", and without it the pose is the DM's camera moving, which only a spectator
 * that chose to follow applies.
 */
export type CameraPoseMessage = CameraPose & {
  readonly sceneId: string;
  readonly pull: boolean;
};

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Parse one `camera.pose` payload. Returns null for anything malformed, so a bad frame is ignored
 * rather than moving a camera: a missing field, a non-finite coordinate, a zoom or distance no
 * camera can have (zero or negative), and a missing scene are all refused. Unknown extra fields
 * (the host's `from`, for instance) are ignored.
 */
export function parseCameraPose(data: unknown): CameraPoseMessage | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  const { sceneId } = record;
  if (typeof sceneId !== 'string' || sceneId.length === 0) return null;
  const pull = record.pull === true;
  if (record.mode === '2d') {
    const { centerX, centerZ, zoom } = record;
    if (!finite(centerX) || !finite(centerZ) || !finite(zoom) || zoom <= 0) return null;
    return { mode: '2d', centerX, centerZ, zoom, sceneId, pull };
  }
  if (record.mode === '3d') {
    const { targetX, targetY, targetZ, azimuth, polar, distance } = record;
    if (
      !finite(targetX) ||
      !finite(targetY) ||
      !finite(targetZ) ||
      !finite(azimuth) ||
      !finite(polar) ||
      !finite(distance) ||
      distance <= 0
    ) {
      return null;
    }
    return { mode: '3d', targetX, targetY, targetZ, azimuth, polar, distance, sceneId, pull };
  }
  return null;
}

/**
 * Who may move everyone else's camera: the DM and an enabled co-DM, and nobody else (a spectator
 * or a plain player that sent a pose is dropped by the host relay). A seat with interaction
 * disabled sends nothing, matching UI-SEAT-05 and the rest of the ephemeral path.
 *
 * Which audiences may see the scene a pose names is not decided here: that is PERM-03's one scene
 * rule, and the relay asks the shared `seesScene` (the `visibleTo` filter) rather than a copy.
 */
export function canSendCameraPose(state: Campaign, actor: Actor): boolean {
  if (isHost(actor)) return true;
  const seat = seatOf(state, actor);
  return seat !== undefined && seat.role === 'codm' && seat.interactionEnabled !== false;
}
