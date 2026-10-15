import { createStore } from 'zustand/vanilla';
import { clampOrbit, type Orbit3D } from './camera-3d.js';

/**
 * UI-CAM-01..03 (CAM-02): the Pan panel's 3D camera joystick, as pure maths plus the input the
 * panel hands to the orbit camera. No DOM or Three.js here.
 *
 * The joystick only rotates (about world Y) and tilts; it never pans, dollies or changes the focus
 * height (UI-CAM-02: no elevation, no left/right pan). Every result goes through `clampOrbit`, so
 * the tilt keeps the orbit camera's own [MIN_POLAR, MAX_POLAR] limits.
 *
 * Directions follow the mouse orbit (OrbitControls3D): pushing the knob right swings the camera the
 * same way a right-drag to the right does (clockwise seen from above, azimuth decreasing). Pushing
 * it forward (up) tilts the camera forward, down toward the board (polar decreasing); back tilts it
 * toward the horizon.
 */

/** Radians per second of rotation at full deflection. */
export const JOYSTICK_ROTATE_RATE = Math.PI / 2;
/** Radians per second of tilt at full deflection. */
export const JOYSTICK_TILT_RATE = Math.PI / 4;
/** One press of a rotate button, or one arrow key on the joystick, in radians. */
export const ROTATE_STEP = Math.PI / 12;
/** One arrow key of tilt on the joystick, in radians. */
export const TILT_STEP = Math.PI / 36;
/** Deflection below this fraction of the radius is ignored, so a resting thumb does not drift. */
export const JOYSTICK_DEADZONE = 0.12;
/** A frame gap longer than this is treated as this long, so a stalled tab cannot spin the camera. */
export const MAX_FRAME_SECONDS = 0.05;

/** Knob deflection, each axis in [-1, 1]: `rotate` > 0 is clockwise, `tilt` > 0 is forward. */
export interface JoystickInput {
  rotate: number;
  tilt: number;
}

export const IDLE_INPUT: Readonly<JoystickInput> = Object.freeze({ rotate: 0, tilt: 0 });

const finite = (v: number) => (Number.isFinite(v) ? v : 0);

export function isIdle(input: JoystickInput): boolean {
  return input.rotate === 0 && input.tilt === 0;
}

/**
 * Knob offset in screen pixels (x right, y down) to a deflection. The offset is limited to the
 * joystick's radius, and a dead zone near the centre reads as idle.
 */
export function joystickDeflection(dxPx: number, dyPx: number, radiusPx: number): JoystickInput {
  const radius = Math.max(1, finite(radiusPx));
  let x = finite(dxPx) / radius;
  let y = finite(dyPx) / radius;
  const length = Math.hypot(x, y);
  if (length < JOYSTICK_DEADZONE) return { rotate: 0, tilt: 0 };
  if (length > 1) {
    x /= length;
    y /= length;
  }
  // `+ 0` folds a negative zero into zero, so an axis at rest compares equal to IDLE_INPUT.
  return { rotate: x + 0, tilt: -y + 0 };
}

/** Rotate and tilt by explicit angles (radians), clamped to the orbit limits. */
export function nudgeOrbit(o: Orbit3D, rotate: number, tilt: number): Orbit3D {
  return clampOrbit({
    ...o,
    azimuth: o.azimuth - finite(rotate),
    polar: o.polar - finite(tilt),
  });
}

/** Integrate a held deflection over one frame. */
export function joystickOrbit(o: Orbit3D, input: JoystickInput, dtSeconds: number): Orbit3D {
  const dt = Math.min(Math.max(finite(dtSeconds), 0), MAX_FRAME_SECONDS);
  const rotate = Math.max(-1, Math.min(1, finite(input.rotate)));
  const tilt = Math.max(-1, Math.min(1, finite(input.tilt)));
  return nudgeOrbit(o, rotate * JOYSTICK_ROTATE_RATE * dt, tilt * JOYSTICK_TILT_RATE * dt);
}

/** The angles one arrow key moves the camera by, or null for any other key. */
export function joystickKeyStep(key: string): { rotate: number; tilt: number } | null {
  switch (key) {
    case 'ArrowLeft':
      return { rotate: -ROTATE_STEP, tilt: 0 };
    case 'ArrowRight':
      return { rotate: ROTATE_STEP, tilt: 0 };
    case 'ArrowUp':
      return { rotate: 0, tilt: TILT_STEP };
    case 'ArrowDown':
      return { rotate: 0, tilt: -TILT_STEP };
    default:
      return null;
  }
}

interface CameraJoystickState {
  /** The knob's current deflection; the orbit camera integrates it every frame while non-zero. */
  input: JoystickInput;
  /** Step angles (radians) not yet applied by the orbit camera. */
  pending: { rotate: number; tilt: number };
  /** Bumped whenever the mouse moves the 3D camera; the open panel closes on it (UI-CAM-03). */
  mouseMoves: number;
  setInput(input: JoystickInput): void;
  step(rotate: number, tilt: number): void;
  /** Hands the pending steps to the camera and clears them. */
  takePending(): { rotate: number; tilt: number };
  mouseMoved(): void;
}

/**
 * The panel's input, handed to the mounted orbit camera. The camera's pose stays in the orbit
 * controls alone (CAM-02); this store only carries what the panel asks for. Local view state:
 * never an action, never sent to the host.
 */
export const cameraJoystickStore = createStore<CameraJoystickState>()((set, get) => ({
  input: IDLE_INPUT,
  pending: { rotate: 0, tilt: 0 },
  mouseMoves: 0,
  setInput(input) {
    const current = get().input;
    if (current.rotate === input.rotate && current.tilt === input.tilt) return;
    set({ input: isIdle(input) ? IDLE_INPUT : { ...input } });
  },
  step(rotate, tilt) {
    const { pending } = get();
    set({
      pending: { rotate: pending.rotate + finite(rotate), tilt: pending.tilt + finite(tilt) },
    });
  },
  takePending() {
    const { pending } = get();
    if (pending.rotate !== 0 || pending.tilt !== 0) set({ pending: { rotate: 0, tilt: 0 } });
    return pending;
  },
  mouseMoved() {
    set({ mouseMoves: get().mouseMoves + 1 });
  },
}));
