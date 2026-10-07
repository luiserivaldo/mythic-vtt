import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { OrthographicCamera } from 'three';
import { defaultOrbit, type GroundBounds, type Orbit3D } from './camera-3d.js';
import { DEFAULT_VIEW, type View2D } from './camera-2d.js';
import type { ViewMode } from './view-mode-store.js';
import {
  lerpOrbit,
  orbitToView2d,
  TWEEN_MS,
  tweenProgress,
  view2dToOrbit,
} from './view-transition.js';

interface Tween {
  from: Orbit3D;
  to: Orbit3D;
  /** performance.now() of the first posed frame; null until the 3D camera is mounted. */
  startedAt: number | null;
  /** Camera stays 3D until an 'out' tween finishes, then the orthographic camera takes over. */
  direction: 'in' | 'out';
}

export interface ViewDirector {
  /** Which camera/representation is mounted right now (lags the target during the 'out' tween). */
  rendered: ViewMode;
  /** 3D orbit state shared with OrbitControls3D. */
  orbitRef: RefObject<Orbit3D>;
  /** Set by OrbitControls3D: poses the camera and updates orbitRef. */
  applyRef: RefObject<((o: Orbit3D) => void) | null>;
  /** Pose to start the orbit camera from after a switch (null when mounted directly in 3D). */
  keepInitialOrbit: boolean;
  /** 2D framing to restore when the orthographic camera is (re)mounted. */
  view2d: View2D;
}

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Drives the 2D <-> 3D switch (M2-05). Entering 3D mounts the orbit camera at a top-down pose
 * matching the 2D framing and tweens to the 3D view; leaving 3D tweens back to top-down and only
 * then swaps the orthographic camera in. Frames are requested only while the tween runs.
 */
export function useViewDirector(target: ViewMode, bounds: GroundBounds | null): ViewDirector {
  const invalidate = useThree((s) => s.invalidate);
  const getState = useThree((s) => s.get);
  const [rendered, setRendered] = useState<ViewMode>(target);
  const [view2d, setView2d] = useState<View2D>(DEFAULT_VIEW);
  const initialSize = getState().size;
  const orbitRef = useRef<Orbit3D>(
    defaultOrbit(bounds, initialSize.width / Math.max(initialSize.height, 1)),
  );
  const applyRef = useRef<((o: Orbit3D) => void) | null>(null);
  const tween = useRef<Tween | null>(null);
  const resting3d = useRef<Orbit3D | null>(null);
  const lastTarget = useRef<ViewMode>(target);
  // Incrementing key lets OrbitControls3D know the initial pose is intentional (not a reset).
  const [keepInitialOrbit, setKeep] = useState(false);

  useEffect(() => {
    if (lastTarget.current === target) return;
    lastTarget.current = target;
    const { camera, size } = getState();
    const height = size.height;
    const default3d = () => defaultOrbit(bounds, size.width / Math.max(height, 1));
    if (target === '3d') {
      if (rendered === '2d') {
        const ortho = camera as OrthographicCamera;
        const view: View2D = {
          centerX: ortho.position.x,
          centerZ: ortho.position.z,
          zoom: ortho.zoom,
        };
        const dest = { ...default3d(), targetX: view.centerX, targetZ: view.centerZ };
        const from = view2dToOrbit(view, height);
        orbitRef.current = from;
        resting3d.current = dest;
        setKeep(true);
        setView2d(view);
        tween.current = { from, to: dest, startedAt: null, direction: 'in' };
        setRendered('3d');
      } else {
        // Reversed mid-way through the 'out' tween: head back to the pose we left.
        tween.current = {
          from: orbitRef.current,
          to: resting3d.current ?? default3d(),
          startedAt: null,
          direction: 'in',
        };
      }
    } else {
      // Remember the 3D pose so a quick toggle back lands where the user was.
      const from = orbitRef.current;
      if (tween.current?.direction !== 'in') resting3d.current = from;
      const view = orbitToView2d(from, height);
      setView2d(view);
      tween.current = { from, to: view2dToOrbit(view, height), startedAt: null, direction: 'out' };
    }
    invalidate();
  }, [target, rendered, bounds, getState, invalidate]);

  useFrame(() => {
    const t = tween.current;
    const apply = applyRef.current;
    if (!t || !apply) {
      if (t) invalidate();
      return;
    }
    const now = performance.now();
    t.startedAt ??= now;
    const duration = reducedMotion() ? 0 : TWEEN_MS;
    const p = tweenProgress(now - t.startedAt, duration);
    apply(lerpOrbit(t.from, t.to, p));
    if (p < 1) {
      invalidate();
      return;
    }
    tween.current = null;
    if (t.direction === 'out') {
      setKeep(false);
      setRendered('2d');
    } else {
      resting3d.current = t.to;
    }
    invalidate();
  });

  return { rendered, orbitRef, applyRef, keepInitialOrbit, view2d };
}
