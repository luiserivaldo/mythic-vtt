import { describe, expect, it } from 'vitest';
import { parseCameraPose, type CameraPose2D, type CameraPose3D } from '@mythic/shared';
import {
  clampOrbit,
  MAX_DISTANCE,
  MAX_POLAR,
  MIN_DISTANCE,
  MIN_POLAR,
  type Orbit3D,
} from './camera-3d.js';
import { MAX_ZOOM, MIN_ZOOM, type View2D } from './camera-2d.js';
import {
  acceptsCameraPose,
  cameraPoseFrame,
  POSE_HEARTBEAT_MS,
  POSE_SEND_INTERVAL_MS,
  POSE_STALE_MS,
  poseChanged,
  poseViewerOf,
  poseFromOrbit,
  poseFromView2D,
  orbitFromPose,
  shouldSendPose,
  viewFromPose,
} from './camera-link.js';

const BOUNDS = { width: 40, height: 30 };
const GROUND = { minX: 0, maxX: 40, minZ: 0, maxZ: 30 };

const view: View2D = { centerX: 12, centerZ: 18, zoom: 64 };
const orbit: Orbit3D = {
  targetX: 12,
  targetY: 3,
  targetZ: 18,
  azimuth: 1.2,
  polar: 0.9,
  distance: 30,
};

/** The wire frame the DM would publish for this view or orbit: a parsed pose carries its scene. */
const WIRE_SCENE = 'scene-1';
const wire2d = (
  over: Partial<CameraPose2D> = {},
  pull = false,
): CameraPose2D & { sceneId: string; pull: boolean } => ({
  ...poseFromView2D(view),
  ...over,
  sceneId: WIRE_SCENE,
  pull,
});
const wire3d = (
  over: Partial<CameraPose3D> = {},
  pull = false,
): CameraPose3D & { sceneId: string; pull: boolean } => ({
  ...poseFromOrbit(orbit),
  ...over,
  sceneId: WIRE_SCENE,
  pull,
});

describe('camera link (M4-11, CAM-06)', () => {
  it('reads the live 2D view and 3D orbit as a wire pose', () => {
    expect(poseFromView2D(view)).toEqual<CameraPose2D>({
      mode: '2d',
      centerX: 12,
      centerZ: 18,
      zoom: 64,
    });
    expect(poseFromOrbit(orbit)).toEqual<CameraPose3D>({ mode: '3d', ...orbit });
  });

  it('publishes a frame that names its scene, so the host and a peer can parse it (CAM-06)', () => {
    // The wire frame the DM sends must carry the scene it was taken in: the host drops a pose that
    // cannot name one (invalid-scene-reference) and a peer's parser refuses it, so a frame without
    // a scene is exactly the payload that never moved anyone.
    expect(parseCameraPose(cameraPoseFrame(poseFromView2D(view), WIRE_SCENE, true))).toEqual({
      ...poseFromView2D(view),
      sceneId: WIRE_SCENE,
      pull: true,
    });
    expect(parseCameraPose({ ...poseFromView2D(view), pull: true })).toBeNull();
  });

  it('round-trips a pose that needs no clamping', () => {
    expect(viewFromPose(wire2d(), BOUNDS)).toEqual(view);
    expect(orbitFromPose(wire3d(), GROUND)).toEqual(orbit);
  });

  it('clamps an adopted 2D pose to the local zoom range and the canvas (D37)', () => {
    expect(viewFromPose(wire2d({ zoom: MAX_ZOOM * 4 }), BOUNDS).zoom).toBe(MAX_ZOOM);
    const tight = viewFromPose(wire2d({ centerX: -900, centerZ: 900, zoom: 0.001 }), BOUNDS);
    expect(tight.zoom).toBe(MIN_ZOOM);
    // The pan margin keeps the centre on (or just past) the board, as a local pan does.
    expect(tight.centerX).toBe(-3);
    expect(tight.centerZ).toBe(33);
  });

  it('lets a non-finite centre fall back to the canvas centre rather than NaN', () => {
    expect(viewFromPose(wire2d({ centerX: Number.NaN }), BOUNDS).centerX).toBe(BOUNDS.width / 2);
  });

  it('clamps an adopted 3D pose to the local orbit invariants and the canvas (D37)', () => {
    const adopted = orbitFromPose(
      wire3d(
        {
          targetX: 900,
          targetY: -5,
          targetZ: -900,
          azimuth: 4 * Math.PI,
          polar: Math.PI,
          distance: 10_000,
        },
        true,
      ),
      GROUND,
    );
    expect(adopted.polar).toBe(MAX_POLAR);
    expect(adopted.distance).toBe(MAX_DISTANCE);
    expect(adopted.targetX).toBe(GROUND.maxX);
    expect(adopted.targetZ).toBe(GROUND.minZ);
    expect(adopted.targetY).toBeGreaterThanOrEqual(0);
    expect(Math.abs(adopted.azimuth)).toBeLessThanOrEqual(Math.PI);
    // The same invariants the local orbit camera enforces, not a second set of numbers.
    expect(adopted).toEqual(clampOrbit({ ...adopted }));

    const near = orbitFromPose(wire3d({ azimuth: 0, polar: 0, distance: 0.01 }), GROUND);
    expect(near.polar).toBe(MIN_POLAR);
    expect(near.distance).toBe(MIN_DISTANCE);
  });

  it('keeps the 3D focus on the board when there is no canvas yet', () => {
    const adopted = orbitFromPose(wire3d({ targetX: 900, targetZ: 900 }), null);
    expect(adopted.targetX).toBe(900);
    expect(adopted.targetZ).toBe(900);
  });

  it('reports whether a pose would move the camera, and tolerates a NaN reading', () => {
    const pose = poseFromView2D(view);
    expect(poseChanged(pose, { ...pose }, 1e-3)).toBe(false);
    expect(poseChanged(pose, { ...pose, centerX: 12.0005 }, 1e-3)).toBe(false);
    expect(poseChanged(pose, { ...pose, centerX: 12.5 }, 1e-3)).toBe(true);
    expect(poseChanged(pose, poseFromOrbit(orbit), 1e-3)).toBe(true);
    expect(poseChanged(null, pose, 1e-3)).toBe(true);
    expect(poseChanged(pose, { ...pose, zoom: Number.NaN }, 1e-3)).toBe(true);
    expect(poseChanged({ ...pose, zoom: Number.NaN }, { ...pose, zoom: Number.NaN }, 1e-3)).toBe(
      false,
    );
    const orbitPose = poseFromOrbit(orbit);
    expect(poseChanged(orbitPose, { ...orbitPose, polar: 0.9001 }, 1e-2)).toBe(false);
    expect(poseChanged(orbitPose, { ...orbitPose, polar: 1.2 }, 1e-2)).toBe(true);
  });

  it('throttles the pose stream, and lets a new spectator catch up on the heartbeat', () => {
    expect(POSE_SEND_INTERVAL_MS).toBeGreaterThan(0);
    expect(POSE_SEND_INTERVAL_MS).toBeLessThanOrEqual(200);
    expect(shouldSendPose(null, 1_000)).toBe(true);
    expect(shouldSendPose(1_000, 1_000 + POSE_SEND_INTERVAL_MS - 1)).toBe(false);
    expect(shouldSendPose(1_000, 1_000 + POSE_SEND_INTERVAL_MS)).toBe(true);
    // A heartbeat is slower than the stream and reaches a follower long before a stale pose does.
    expect(POSE_HEARTBEAT_MS).toBeGreaterThan(POSE_SEND_INTERVAL_MS);
    expect(POSE_STALE_MS).toBeGreaterThanOrEqual(POSE_SEND_INTERVAL_MS);
    expect(POSE_STALE_MS).toBeLessThan(POSE_HEARTBEAT_MS * 4);
  });

  it('maps a viewer role to the camera-link role', () => {
    expect(poseViewerOf('host')).toBe('dm');
    expect(poseViewerOf('codm')).toBe('dm');
    expect(poseViewerOf('player')).toBe('player');
    expect(poseViewerOf('observer')).toBe('spectator');
  });

  it('pulls players, never the DM, and lets only a following spectator opt in', () => {
    const pull = wire2d({}, true);
    const follow = wire2d({}, false);

    expect(acceptsCameraPose(pull, 'dm', false)).toBe(false);
    expect(acceptsCameraPose(pull, 'dm', true)).toBe(false);
    expect(acceptsCameraPose(pull, 'player', false)).toBe(true);
    expect(acceptsCameraPose(pull, 'spectator', false)).toBe(false);
    expect(acceptsCameraPose(pull, 'spectator', true)).toBe(true);

    // The continuous DM camera only ever moves a spectator that asked to follow.
    expect(acceptsCameraPose(follow, 'player', true)).toBe(false);
    expect(acceptsCameraPose(follow, 'spectator', false)).toBe(false);
    expect(acceptsCameraPose(follow, 'spectator', true)).toBe(true);
  });
});
