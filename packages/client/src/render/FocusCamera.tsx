import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, type RefObject } from 'react';
import type { OrthographicCamera } from 'three';
import { useStore } from 'zustand';
import type { CanvasSize, View2D } from './camera-2d.js';
import type { GroundBounds, Orbit3D } from './camera-3d.js';
import { focusStore, type FocusTarget } from './focus-store.js';
import { FOCUS_MS, focusOrbit, focusView2D, lerpView2D } from './focus.js';
import { lerpOrbit, tweenProgress } from './view-transition.js';
import type { ViewMode } from './view-mode-store.js';

/** The pose a focus tween travels between, in whichever camera it started. */
type FocusTween =
  | { mode: '2d'; from: View2D; to: View2D; startedAt: number | null }
  | { mode: '3d'; from: Orbit3D; to: Orbit3D; startedAt: number | null };

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * CAM-06: animates the camera onto a token that was double-clicked. It drives whichever camera is
 * mounted — the 2D orthographic one directly, the 3D orbit through the view director's apply — over
 * `FOCUS_MS`, well inside the ≤ 300 ms interaction budget, and wakes the on-demand loop only while
 * the tween runs. A 2D↔3D switch (or the camera swap inside it) cancels a focus in flight instead
 * of fighting the toggle tween. Maths lives in focus.ts.
 */
export function FocusCamera({
  mode,
  bounds,
  canvasSize,
  orbitRef,
  applyRef,
}: {
  /** The requested view mode: switching cancels a focus in flight. */
  mode: ViewMode;
  /** Canvas extent (D37): the 3D focus stays on the board. */
  bounds: GroundBounds | null;
  /** Canvas extent (D37): the 2D centre stays on the board. */
  canvasSize: CanvasSize;
  orbitRef: RefObject<Orbit3D>;
  applyRef: RefObject<((o: Orbit3D) => void) | null>;
}): null {
  const invalidate = useThree((s) => s.invalidate);
  const getState = useThree((s) => s.get);
  const request = useStore(focusStore, (s) => s.target);
  const tween = useRef<FocusTween | null>(null);
  /** The request already being followed; a request made before this mounted is still honoured. */
  const handled = useRef<FocusTarget | null>(null);
  const poses = useRef(0);

  useEffect(() => {
    if (request === null || handled.current === request) return;
    const camera = getState().camera as OrthographicCamera;
    if (!camera.isOrthographicCamera) {
      // The 2D↔3D director poses the orbit camera; without it there is nothing to move yet.
      if (!applyRef.current) return;
      const from = { ...orbitRef.current };
      tween.current = {
        mode: '3d',
        from,
        to: focusOrbit(from, request.x, request.y, request.z, bounds),
        startedAt: null,
      };
    } else {
      const from: View2D = {
        centerX: camera.position.x,
        centerZ: camera.position.z,
        zoom: camera.zoom,
      };
      tween.current = {
        mode: '2d',
        from,
        to: focusView2D(from, request.x, request.z, canvasSize),
        startedAt: null,
      };
    }
    // Consumed only once a tween is armed, so a request during a 2D↔3D switch is not swallowed.
    handled.current = request;
    poses.current = 0;
    invalidate();
  }, [request, bounds, canvasSize, getState, invalidate, orbitRef, applyRef]);

  useFrame(() => {
    const t = tween.current;
    if (!t) return;
    const camera = getState().camera as OrthographicCamera;
    // A view switch swaps the camera under the tween; drop it rather than write the wrong one.
    const wrongCamera =
      t.mode === '2d' ? !camera.isOrthographicCamera : camera.isOrthographicCamera;
    if (t.mode !== mode || wrongCamera) {
      tween.current = null;
      return;
    }
    const now = performance.now();
    t.startedAt ??= now;
    const p = tweenProgress(now - t.startedAt, reducedMotion() ? 0 : FOCUS_MS);
    if (t.mode === '2d') {
      const view = lerpView2D(t.from, t.to, p);
      camera.position.x = view.centerX;
      camera.position.z = view.centerZ;
      camera.zoom = view.zoom;
      camera.updateProjectionMatrix();
    } else {
      const apply = applyRef.current;
      if (!apply) {
        tween.current = null;
        return;
      }
      apply(lerpOrbit(t.from, t.to, p));
    }
    poses.current += 1;
    if (p < 1) {
      invalidate();
      return;
    }
    tween.current = null;
    invalidate();
  });

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const diagnostics = {
      /** The live 2D camera, whether a focus is in flight and how many poses it has applied. */
      getView2d: () => {
        const camera = getState().camera as OrthographicCamera;
        return {
          centerX: camera.position.x,
          centerZ: camera.position.z,
          zoom: camera.zoom,
          animating: tween.current !== null,
          poses: poses.current,
        };
      },
    };
    window.__mythicFocus = diagnostics;
    return () => {
      if (window.__mythicFocus === diagnostics) delete window.__mythicFocus;
    };
  }, [getState]);

  return null;
}
