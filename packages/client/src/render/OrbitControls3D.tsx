import { useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera } from '@react-three/drei';
import { useCallback, useEffect, useRef } from 'react';
import type { PerspectiveCamera as ThreePerspectiveCamera } from 'three';
import {
  clampTargetToGround,
  dampVelocity,
  defaultOrbit,
  dolly,
  FOV_DEGREES,
  orbitByPixels,
  orbitPosition,
  panOnGround,
  pinchUpdate,
  ROTATE_SPEED,
  wheelFactor,
  type GroundBounds,
  type Orbit3D,
  type Point,
} from './camera-3d.js';

export interface OrbitControls3DProps {
  /** D37: canvas extent: the default/reset view frames it and the focus is clamped to it. Keep the reference stable (memoise). */
  bounds: GroundBounds | null;
  /** Increment to return to the default view. */
  resetToken?: number;
}

/**
 * Self-contained 3D camera (CAM-02): perspective camera + orbit/pan/dolly input.
 * Mouse: right/middle drag orbits, shift+right/middle drag pans, wheel dollies.
 * Touch: one finger orbits, two fingers pinch-zoom and pan. Left mouse is left alone so
 * selection and token tools keep working. Not mounted by default (the 2D↔3D toggle is M2-05).
 * Maths lives in camera-3d.ts; the camera up vector is always +Y so roll cannot occur.
 */
export function OrbitControls3D({ bounds, resetToken = 0 }: OrbitControls3DProps) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const getState = useThree((s) => s.get);
  const activeCamera = useThree((s) => s.camera);
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;
  const orbit = useRef<Orbit3D>(defaultOrbit(bounds));
  // Angular velocity (rad/s) used for post-release damping; only moves the camera while non-zero.
  const velocity = useRef({ az: 0, polar: 0 });

  const apply = useCallback(
    (raw: Orbit3D) => {
      // D37: the focus stays on the canvas.
      const next = clampTargetToGround(raw, boundsRef.current);
      orbit.current = next;
      const cam = getState().camera as ThreePerspectiveCamera;
      const p = orbitPosition(next);
      cam.up.set(0, 1, 0);
      cam.position.set(p.x, p.y, p.z);
      cam.lookAt(next.targetX, next.targetY, next.targetZ);
      cam.updateMatrixWorld();
      invalidate();
    },
    [getState, invalidate],
  );

  // Reset on mount, on token change and when the scene bounds change.
  useEffect(() => {
    velocity.current = { az: 0, polar: 0 };
    apply(defaultOrbit(bounds));
  }, [bounds, resetToken, apply]);

  // The drei camera replaces the default one after mount: pose it as soon as it is active.
  useEffect(() => {
    apply(orbit.current);
  }, [activeCamera, apply]);

  // Continue damped rotation; frames are only requested while velocity is non-zero.
  useFrame((_, delta) => {
    const v = velocity.current;
    if (v.az === 0 && v.polar === 0) return;
    const dt = Math.min(delta, 0.05);
    apply(orbitByPixels(orbit.current, (v.az * dt) / ROTATE_SPEED, (v.polar * dt) / ROTATE_SPEED));
    v.az = dampVelocity(v.az, dt);
    v.polar = dampVelocity(v.polar, dt);
  });

  useEffect(() => {
    const el = gl.domElement;
    const pointers = new Map<number, Point>();
    const modes = new Map<number, 'orbit' | 'pan'>();
    let lastMoveTime = 0;
    const rect = () => el.getBoundingClientRect();
    const local = (e: { clientX: number; clientY: number }): Point => {
      const r = rect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      apply(dolly(orbit.current, wheelFactor(e)));
    };

    const onPointerDown = (e: PointerEvent) => {
      const isMouse = e.pointerType === 'mouse';
      if (isMouse && e.button === 0) return;
      velocity.current = { az: 0, polar: 0 };
      pointers.set(e.pointerId, local(e));
      modes.set(e.pointerId, isMouse && e.shiftKey ? 'pan' : 'orbit');
      el.setPointerCapture(e.pointerId);
      lastMoveTime = e.timeStamp;
    };

    const onPointerMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const next = local(e);
      if (pointers.size >= 2) {
        const before = [...pointers.values()];
        const after = [...pointers.entries()].map(([id, p]) => (id === e.pointerId ? next : p));
        const [b0, b1] = before;
        const [a0, a1] = after;
        if (b0 && b1 && a0 && a1)
          apply(pinchUpdate(orbit.current, rect().height, [b0, b1], [a0, a1]));
      } else {
        const dx = next.x - prev.x;
        const dy = next.y - prev.y;
        if (modes.get(e.pointerId) === 'pan') {
          apply(panOnGround(orbit.current, dx, dy, rect().height));
        } else {
          apply(orbitByPixels(orbit.current, dx, dy));
          const dt = Math.max((e.timeStamp - lastMoveTime) / 1000, 1 / 240);
          velocity.current = { az: (-dx * ROTATE_SPEED) / dt, polar: (-dy * ROTATE_SPEED) / dt };
        }
      }
      lastMoveTime = e.timeStamp;
      pointers.set(e.pointerId, next);
    };

    const onPointerEnd = (e: PointerEvent) => {
      const wasOnlyPointer = pointers.size === 1;
      pointers.delete(e.pointerId);
      modes.delete(e.pointerId);
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      // Only a quick flick keeps spinning; a held-then-released drag stops dead.
      if (!wasOnlyPointer || e.timeStamp - lastMoveTime > 60)
        velocity.current = { az: 0, polar: 0 };
      if (velocity.current.az !== 0 || velocity.current.polar !== 0) invalidate();
    };

    // Right-drag orbits, so the browser menu must not open.
    const onContextMenu = (e: Event) => {
      e.preventDefault();
    };

    const prevTouchAction = el.style.touchAction;
    el.style.touchAction = 'none';
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerEnd);
    el.addEventListener('pointercancel', onPointerEnd);
    el.addEventListener('contextmenu', onContextMenu);
    return () => {
      el.style.touchAction = prevTouchAction;
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerEnd);
      el.removeEventListener('pointercancel', onPointerEnd);
      el.removeEventListener('contextmenu', onContextMenu);
    };
  }, [gl, apply, invalidate]);

  return <PerspectiveCamera makeDefault fov={FOV_DEGREES} near={0.1} far={2000} />;
}
