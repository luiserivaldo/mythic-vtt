import { useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera } from '@react-three/drei';
import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';
import type { PerspectiveCamera as ThreePerspectiveCamera } from 'three';
import {
  clampTargetToGround,
  dampVelocity,
  defaultOrbit,
  dolly,
  DEFAULT_FOV_DEGREES,
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
import { cameraPress, isDrag } from './board-input.js';
import { cameraJoystickStore, isIdle, joystickOrbit, nudgeOrbit } from './camera-joystick.js';
import { pointerClaims } from './pointer-claims.js';

export interface OrbitControls3DProps {
  /** D37: canvas extent: the default/reset view frames it and the focus is clamped to it. Keep the reference stable (memoise). */
  bounds: GroundBounds | null;
  /** Increment to return to the default view. */
  resetToken?: number;
  /** M2-05: share the orbit state with the view director (otherwise private). */
  orbitRef?: RefObject<Orbit3D>;
  /** M2-05: receives a function that poses the camera and updates the orbit (tween driver). */
  applyRef?: RefObject<((o: Orbit3D) => void) | null>;
  /** M2-05: mount at `orbitRef`'s pose instead of the default view (Reset view still resets). */
  keepInitialOrbit?: boolean;
  /** The rail tool in effect; only Pan lets a left drag move the camera (UI-INPUT-01, UI-TOOL-02). */
  tool?: string;
}

/**
 * Self-contained 3D camera (CAM-02): perspective camera + orbit/pan/dolly input.
 * Mouse (board-input, UI-INPUT-01..04): right-drag orbits; middle-drag pans, and so does left-drag
 * with the Pan tool; wheel dollies. A mouse press waits for the drag threshold, so a right click
 * opens the menu and a middle click toggles flying without nudging the camera.
 * Touch: one finger orbits, two fingers pinch-zoom and pan. Board tools claim left presses
 * before the camera sees them. Mounted by the 2D↔3D toggle (M2-05).
 * Maths lives in camera-3d.ts; the camera up vector is always +Y so roll cannot occur.
 */
export function OrbitControls3D({
  bounds: boundsProp,
  resetToken = 0,
  orbitRef,
  applyRef,
  keepInitialOrbit = false,
  tool = 'pan',
}: OrbitControls3DProps) {
  // Compare bounds by value: a new object with the same extent (e.g. after an entity moves)
  // must not reset the user's orbit.
  const bMinX = boundsProp?.minX;
  const bMaxX = boundsProp?.maxX;
  const bMinZ = boundsProp?.minZ;
  const bMaxZ = boundsProp?.maxZ;
  const bounds = useMemo<GroundBounds | null>(
    () =>
      bMinX === undefined || bMaxX === undefined || bMinZ === undefined || bMaxZ === undefined
        ? null
        : { minX: bMinX, maxX: bMaxX, minZ: bMinZ, maxZ: bMaxZ },
    [bMinX, bMaxX, bMinZ, bMaxZ],
  );
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const getState = useThree((s) => s.get);
  const activeCamera = useThree((s) => s.camera);
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;
  const ownOrbit = useRef<Orbit3D>(defaultOrbit(bounds));
  const orbit = orbitRef ?? ownOrbit;
  // Angular velocity (rad/s) used for post-release damping; only moves the camera while non-zero.
  const velocity = useRef({ az: 0, polar: 0 });
  const gestureActive = useRef(false);

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
    [getState, invalidate, orbit],
  );

  useEffect(() => {
    if (!applyRef) return;
    applyRef.current = apply;
    return () => {
      applyRef.current = null;
    };
  }, [applyRef, apply]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const diagnostics = {
      getPose: () => ({ ...orbit.current }),
    };
    window.__mythicCamera = diagnostics;
    return () => {
      if (window.__mythicCamera === diagnostics) delete window.__mythicCamera;
    };
  }, [orbit]);

  // Reset on mount, on token change and when the scene bounds change. A view switch keeps the
  // pose it was given; the check is by value so a StrictMode re-run does not reset it either.
  const seen = useRef({ bounds, resetToken });
  useEffect(() => {
    velocity.current = { az: 0, polar: 0 };
    const unchanged = seen.current.bounds === bounds && seen.current.resetToken === resetToken;
    seen.current = { bounds, resetToken };
    const { width, height } = getState().size;
    apply(
      keepInitialOrbit && unchanged
        ? orbit.current
        : defaultOrbit(bounds, width / Math.max(height, 1)),
    );
    // keepInitialOrbit only decides this application; it must not re-trigger a reset.
  }, [bounds, resetToken, apply, getState]);

  // The drei camera replaces the default one after mount: pose it as soon as it is active.
  useEffect(() => {
    apply(orbit.current);
  }, [activeCamera, apply]);

  // UI-CAM-02: the Pan panel's joystick asks for a frame whenever its input changes.
  useEffect(
    () =>
      cameraJoystickStore.subscribe((state, previous) => {
        if (state.input !== previous.input || state.pending !== previous.pending) invalidate();
      }),
    [invalidate],
  );

  // Continue damped rotation; frames are only requested while velocity is non-zero.
  useFrame((_, delta) => {
    // UI-CAM-02: the joystick turns this same orbit, so its tilt keeps the orbit's own clamp. A
    // held knob keeps the on-demand loop running; a released one stops it.
    const joystick = cameraJoystickStore.getState();
    const steps = joystick.takePending();
    const held = !isIdle(joystick.input);
    if (held || steps.rotate !== 0 || steps.tilt !== 0) {
      velocity.current = { az: 0, polar: 0 };
      let next = nudgeOrbit(orbit.current, steps.rotate, steps.tilt);
      if (held) next = joystickOrbit(next, joystick.input, delta);
      apply(next);
      if (held) invalidate();
      return;
    }
    const v = velocity.current;
    if (gestureActive.current || (v.az === 0 && v.polar === 0)) return;
    const dt = Math.min(delta, 0.05);
    apply(
      orbitByPixels(orbit.current, (-v.az * dt) / ROTATE_SPEED, (-v.polar * dt) / ROTATE_SPEED),
    );
    v.az = dampVelocity(v.az, dt);
    v.polar = dampVelocity(v.polar, dt);
  });

  useEffect(() => {
    const el = gl.domElement;
    const pointers = new Map<number, Point>();
    const modes = new Map<number, 'orbit' | 'pan'>();
    const starts = new Map<number, Point>();
    const dragging = new Set<number>();
    let swallowClick = false;
    let lastMoveTime = 0;
    // UI-CAM-03: a mouse that moves the camera closes the Pan panel; report it once per gesture.
    let mouseReported = false;
    const reportMouseMove = () => {
      if (mouseReported) return;
      mouseReported = true;
      cameraJoystickStore.getState().mouseMoved();
    };
    const rect = () => el.getBoundingClientRect();
    const local = (e: { clientX: number; clientY: number }): Point => {
      const r = rect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      apply(dolly(orbit.current, wheelFactor(e)));
      cameraJoystickStore.getState().mouseMoved();
    };

    const onPointerDown = (e: PointerEvent) => {
      if (pointerClaims.isClaimed(e.pointerId)) return;
      const mode = cameraPress('3d', e.pointerType, e.button, tool);
      if (!mode) return;
      velocity.current = { az: 0, polar: 0 };
      const point = local(e);
      pointers.set(e.pointerId, point);
      starts.set(e.pointerId, point);
      modes.set(e.pointerId, mode);
      // A mouse press waits for the drag threshold: a middle click on a selected token toggles
      // flying (TOK-03) and a right click opens the menu, neither nudging the camera. Touch orbits
      // at once.
      if (e.pointerType !== 'mouse') dragging.add(e.pointerId);
      gestureActive.current = true;
      el.setPointerCapture(e.pointerId);
      lastMoveTime = e.timeStamp;
      mouseReported = false;
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
        const start = starts.get(e.pointerId);
        if (!dragging.has(e.pointerId) && start && !isDrag(start, next)) return;
        dragging.add(e.pointerId);
        if (e.pointerType === 'mouse') reportMouseMove();
        if (modes.get(e.pointerId) === 'pan') {
          if (e.pointerType === 'mouse' && e.buttons === 1) swallowClick = true;
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
      starts.delete(e.pointerId);
      dragging.delete(e.pointerId);
      gestureActive.current = pointers.size > 0;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      // Only a quick flick keeps spinning; a held-then-released drag stops dead.
      if (!wasOnlyPointer || e.timeStamp - lastMoveTime > 60)
        velocity.current = { az: 0, polar: 0 };
      if (velocity.current.az !== 0 || velocity.current.polar !== 0) invalidate();
    };

    // A left pan must not become an empty-board click that clears selection on release.
    const onClickCapture = (e: MouseEvent) => {
      if (!swallowClick) return;
      e.stopPropagation();
      swallowClick = false;
    };
    const onPointerDownReset = () => {
      swallowClick = false;
    };

    // Right-drag orbits, so the browser menu must not open.
    const onContextMenu = (e: Event) => {
      e.preventDefault();
    };

    const prevTouchAction = el.style.touchAction;
    el.style.touchAction = 'none';
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onPointerDownReset, true);
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerEnd);
    el.addEventListener('pointercancel', onPointerEnd);
    el.addEventListener('click', onClickCapture, true);
    el.addEventListener('contextmenu', onContextMenu);
    return () => {
      for (const pointerId of pointers.keys()) {
        if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
      }
      gestureActive.current = false;
      el.style.touchAction = prevTouchAction;
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onPointerDownReset, true);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerEnd);
      el.removeEventListener('pointercancel', onPointerEnd);
      el.removeEventListener('click', onClickCapture, true);
      el.removeEventListener('contextmenu', onContextMenu);
    };
  }, [gl, apply, invalidate, tool]);

  return <PerspectiveCamera makeDefault fov={DEFAULT_FOV_DEGREES} near={0.1} far={2000} />;
}
