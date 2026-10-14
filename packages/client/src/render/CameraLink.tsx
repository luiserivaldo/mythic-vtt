import { useFrame, useThree } from '@react-three/fiber';
import { useContext, useEffect, useRef, type RefObject } from 'react';
import type { OrthographicCamera } from 'three';
import { useStore } from 'zustand';
import { CAMERA_POSE_CHANNEL, parseCameraPose, type CameraPose } from '@mythic/shared';
import { useClientStore } from '../store/react.js';
import { useViewedCampaign } from '../store/viewed-campaign.js';
import { EphemeralContext } from '../ui/ephemeral-context.js';
import { viewerRole } from '../ui/viewer.js';
import type { CanvasSize, View2D } from './camera-2d.js';
import type { GroundBounds, Orbit3D } from './camera-3d.js';
import { cameraLinkStore } from './camera-link-store.js';
import {
  acceptsCameraPose,
  cameraPoseFrame,
  orbitFromPose,
  POSE_HEARTBEAT_MS,
  POSE_STALE_MS,
  poseChanged,
  poseFromOrbit,
  poseFromView2D,
  poseViewerOf,
  shouldSendPose,
  viewFromPose,
} from './camera-link.js';
import { lerpView2D } from './focus.js';
import { lerpOrbit, tweenProgress, TWEEN_MS } from './view-transition.js';
import { viewModeStore, type ViewMode } from './view-mode-store.js';

/** A pull in flight between the pose it started from and the one it adopts, per camera mode. */
type PoseTween =
  | { mode: '2d'; from: View2D; to: View2D; startedAt: number | null }
  | { mode: '3d'; from: Orbit3D; to: Orbit3D; startedAt: number | null };

/** A pose that arrived and is waiting for the camera that can adopt it. */
interface PendingPose {
  readonly pose: CameraPose;
  readonly pull: boolean;
  readonly at: number;
}

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * M4-11 (CAM-06): links this client's camera to the DM's.
 *
 * The DM (host or co-DM) publishes its pose on the `camera.pose` ephemeral whenever it moves —
 * throttled, plus a slow heartbeat so a spectator that has just opted in catches up — and one
 * explicit `pull` when the DM asks for it. A player adopts a pull; a spectator adopts every pose
 * while it follows the DM camera. Every adopted pose is clamped to this client's own canvas and
 * zoom range, and a pose that cannot be adopted (a different camera mode mid-switch, a stale
 * frame) is dropped rather than left to fight the camera.
 *
 * This is view state (Pillar 1): it is never an action, never logged, and carries board
 * coordinates only. The host refuses a pose from anyone but the DM, so a player cannot move a
 * camera that is not theirs.
 */
export function CameraLink({
  mode,
  rendered,
  transitioning,
  bounds,
  canvasSize,
  orbitRef,
  applyRef,
}: {
  /** The requested view mode; a pose for the other camera switches to it first. */
  mode: ViewMode;
  /** The camera mode actually mounted (lags `mode` during a switch). */
  rendered: ViewMode;
  /** The 2D↔3D tween is running; a pose waits for it instead of fighting it. */
  transitioning: boolean;
  /** Canvas extent (D37): an adopted 3D focus stays on the board. */
  bounds: GroundBounds | null;
  /** Canvas extent (D37): an adopted 2D centre stays on the board. */
  canvasSize: CanvasSize;
  orbitRef: RefObject<Orbit3D>;
  applyRef: RefObject<((o: Orbit3D) => void) | null>;
}): null {
  const invalidate = useThree((s) => s.invalidate);
  const getState = useThree((s) => s.get);
  const ephemeral = useContext(EphemeralContext);
  const campaign = useViewedCampaign();
  const isHost = useClientStore((s) => s.isHost);
  const seatId = useClientStore((s) => s.seatId);
  const pullToken = useStore(cameraLinkStore, (s) => s.pullToken);
  const following = useStore(cameraLinkStore, (s) => s.following);
  const viewer = poseViewerOf(viewerRole({ isHost, seatId, campaign }));

  const tween = useRef<PoseTween | null>(null);
  const pending = useRef<PendingPose | null>(null);
  const last = useRef<{ pose: CameraPose | null; at: number | null }>({ pose: null, at: null });
  const sent = useRef({ poses: 0, pulls: 0 });
  // CAM-06: the pose must name the scene it was taken in, so the host can drop it for an audience
  // that cannot see that scene (PERM-03); a DM looking at a browsed scene publishes that one.
  const sceneId = campaign?.activeSceneId ?? null;
  const latest = useRef({ ephemeral, bounds, canvasSize, rendered, transitioning, sceneId });
  latest.current = { ephemeral, bounds, canvasSize, rendered, transitioning, sceneId };

  const write2d = (view: View2D): void => {
    const camera = getState().camera as OrthographicCamera;
    camera.position.x = view.centerX;
    camera.position.z = view.centerZ;
    camera.zoom = view.zoom;
    camera.updateProjectionMatrix();
    invalidate();
  };

  /** This client's camera as a wire pose, whichever camera is mounted. */
  const readPose = (): CameraPose => {
    const camera = getState().camera as OrthographicCamera;
    if (camera.isOrthographicCamera) {
      return poseFromView2D({
        centerX: camera.position.x,
        centerZ: camera.position.z,
        zoom: camera.zoom,
      });
    }
    return poseFromOrbit(orbitRef.current);
  };

  const publish = (pull: boolean): void => {
    const { ephemeral: api, sceneId: poseSceneId } = latest.current;
    if (!api || poseSceneId === null) return;
    const pose = readPose();
    const now = performance.now();
    api.send(CAMERA_POSE_CHANNEL, cameraPoseFrame(pose, poseSceneId, pull));
    last.current = { pose, at: now };
    sent.current = { poses: sent.current.poses + 1, pulls: sent.current.pulls + (pull ? 1 : 0) };
  };
  // The heartbeat reads the camera through refs, so a timer that fires between frames is safe.
  const publishRef = useRef(publish);
  publishRef.current = publish;

  // CAM-06: republish the DM's camera on a slow heartbeat, so a spectator that has just chosen to
  // follow catches up even though the DM's camera has not moved since its last pose went out.
  useEffect(() => {
    if (viewer !== 'dm' || !ephemeral) return;
    const timer = setInterval(() => {
      publishRef.current(false);
    }, POSE_HEARTBEAT_MS);
    return () => {
      clearInterval(timer);
    };
  }, [viewer, ephemeral]);

  // A pull is a gesture, not a camera move, so it does not wait for an animation frame: the click
  // itself publishes, and the frame loop keeps running for the moves that follow.
  useEffect(() => {
    if (viewer !== 'dm' || pullToken === 0) return;
    publishRef.current(true);
    invalidate();
  }, [viewer, pullToken, invalidate]);

  /** Adopt a pose: clamp it, then tween a pull or mirror a followed camera directly. */
  const adopt = (entry: PendingPose): void => {
    const camera = getState().camera as OrthographicCamera;
    if (entry.pose.mode === '2d') {
      if (!camera.isOrthographicCamera || latest.current.rendered !== '2d') return;
      const to = viewFromPose(entry.pose, latest.current.canvasSize);
      const from: View2D = {
        centerX: camera.position.x,
        centerZ: camera.position.z,
        zoom: camera.zoom,
      };
      if (entry.pull) {
        tween.current = { mode: '2d', from, to, startedAt: null };
        invalidate();
      } else {
        write2d(to);
      }
      pending.current = null;
      return;
    }
    const apply = applyRef.current;
    if (camera.isOrthographicCamera || !apply || latest.current.rendered !== '3d') return;
    const to = orbitFromPose(entry.pose, latest.current.bounds);
    if (entry.pull) {
      tween.current = { mode: '3d', from: { ...orbitRef.current }, to, startedAt: null };
      invalidate();
    } else {
      apply(to);
    }
    pending.current = null;
  };

  useFrame(() => {
    // A pull in flight takes the camera; a followed pose is applied straight to the camera.
    const t = tween.current;
    if (t !== null) {
      const camera = getState().camera as OrthographicCamera;
      const wrongCamera =
        t.mode === '2d' ? !camera.isOrthographicCamera : camera.isOrthographicCamera;
      if (t.mode !== latest.current.rendered || wrongCamera) {
        tween.current = null;
      } else {
        const now = performance.now();
        t.startedAt ??= now;
        const p = tweenProgress(now - t.startedAt, reducedMotion() ? 0 : TWEEN_MS);
        if (t.mode === '2d') {
          write2d(lerpView2D(t.from, t.to, p));
        } else {
          const apply = applyRef.current;
          if (!apply) {
            tween.current = null;
          } else {
            apply(lerpOrbit(t.from, t.to, p));
            if (p < 1) invalidate();
            else tween.current = null;
          }
        }
      }
    }

    const entry = pending.current;
    if (entry !== null) {
      if (performance.now() - entry.at > POSE_STALE_MS) {
        pending.current = null;
      } else if (entry.pose.mode !== mode) {
        // The other camera is the one that can adopt this pose; switch and retry next frame.
        if (viewModeStore.getState().mode !== entry.pose.mode) {
          viewModeStore.getState().set(entry.pose.mode);
        }
        invalidate();
      } else if (!latest.current.transitioning) {
        adopt(entry);
      } else {
        invalidate();
      }
    }

    if (viewer === 'dm') {
      if (!poseChanged(last.current.pose, readPose())) return;
      if (!shouldSendPose(last.current.at, performance.now())) {
        // Hold the frame loop open until the throttle lets the move out.
        invalidate();
        return;
      }
      publish(false);
    }
  });

  // Receiving is off for a DM: a camera you own is never moved by a peer or your own echo.
  useEffect(() => {
    if (!ephemeral || viewer === 'dm') return;
    return ephemeral.on((message) => {
      if (
        message.channel !== CAMERA_POSE_CHANNEL ||
        message.from === undefined ||
        message.from === ephemeral.identityId
      ) {
        return;
      }
      const pose = parseCameraPose(message.data);
      if (pose === null) return;
      if (!acceptsCameraPose(pose, viewer, cameraLinkStore.getState().following)) return;
      pending.current = { pose, pull: pose.pull, at: performance.now() };
      invalidate();
    });
  }, [ephemeral, viewer, invalidate]);

  // A spectator that stops following drops whatever was still on its way.
  useEffect(() => {
    if (!following) pending.current = null;
  }, [following]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const diagnostics = {
      getLink: () => ({
        sent: sent.current.poses,
        pulls: sent.current.pulls,
        following: cameraLinkStore.getState().following,
      }),
    };
    window.__mythicCameraLink = diagnostics;
    return () => {
      if (window.__mythicCameraLink === diagnostics) delete window.__mythicCameraLink;
    };
  }, []);

  return null;
}
