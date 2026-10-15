import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultOrbit, MAX_POLAR, MIN_POLAR, orbitByPixels, type Orbit3D } from './camera-3d.js';
import {
  cameraJoystickStore,
  IDLE_INPUT,
  JOYSTICK_DEADZONE,
  JOYSTICK_ROTATE_RATE,
  JOYSTICK_TILT_RATE,
  joystickDeflection,
  joystickKeyStep,
  joystickOrbit,
  MAX_FRAME_SECONDS,
  nudgeOrbit,
  ROTATE_STEP,
  TILT_STEP,
} from './camera-joystick.js';

const base: Orbit3D = defaultOrbit(null);
const num = (min: number, max: number) => fc.double({ min, max, noNaN: true });

/** Only rotation and tilt may change: no pan, no dolly, no elevation (UI-CAM-02). */
function expectOnlyRotateTilt(before: Orbit3D, after: Orbit3D) {
  expect(after.targetX).toBe(before.targetX);
  expect(after.targetY).toBe(before.targetY);
  expect(after.targetZ).toBe(before.targetZ);
  expect(after.distance).toBe(before.distance);
}

describe('UI-CAM-02 joystick deflection', () => {
  it('maps the knob offset to rotate (right) and tilt (forward is up)', () => {
    expect(joystickDeflection(40, 0, 40)).toEqual({ rotate: 1, tilt: 0 });
    expect(joystickDeflection(-20, 0, 40)).toEqual({ rotate: -0.5, tilt: 0 });
    expect(joystickDeflection(0, -40, 40)).toEqual({ rotate: 0, tilt: 1 });
    expect(joystickDeflection(0, 20, 40)).toEqual({ rotate: 0, tilt: -0.5 });
  });

  it('ignores a resting thumb inside the dead zone', () => {
    const inside = JOYSTICK_DEADZONE * 40 * 0.9;
    expect(joystickDeflection(inside, 0, 40)).toEqual(IDLE_INPUT);
    expect(joystickDeflection(0, 0, 40)).toEqual(IDLE_INPUT);
  });

  it('never exceeds the unit circle, whatever the pointer does', () => {
    fc.assert(
      fc.property(num(-1e4, 1e4), num(-1e4, 1e4), num(-10, 200), (dx, dy, r) => {
        const d = joystickDeflection(dx, dy, r);
        expect(Math.hypot(d.rotate, d.tilt)).toBeLessThanOrEqual(1 + 1e-9);
      }),
    );
    expect(joystickDeflection(Number.NaN, Infinity, 40)).toEqual(IDLE_INPUT);
  });
});

describe('UI-CAM-02 joystick to camera', () => {
  it('rotates clockwise like a right-drag of the mouse orbit, at the rotate rate', () => {
    const next = joystickOrbit(base, { rotate: 1, tilt: 0 }, 0.02);
    expect(next.azimuth).toBeCloseTo(base.azimuth - JOYSTICK_ROTATE_RATE * 0.02, 10);
    expect(next.polar).toBeCloseTo(base.polar, 12);
    // Same sense as dragging right with the right button (OrbitControls3D).
    expect(Math.sign(orbitByPixels(base, 10, 0).azimuth - base.azimuth)).toBe(
      Math.sign(next.azimuth - base.azimuth),
    );
    expectOnlyRotateTilt(base, next);
    const back = joystickOrbit(base, { rotate: -1, tilt: 0 }, 0.02);
    expect(back.azimuth).toBeGreaterThan(base.azimuth);
  });

  it('tilts forward toward the board and back toward the horizon', () => {
    const forward = joystickOrbit(base, { rotate: 0, tilt: 1 }, 0.02);
    expect(forward.polar).toBeCloseTo(base.polar - JOYSTICK_TILT_RATE * 0.02, 10);
    expect(forward.azimuth).toBeCloseTo(base.azimuth, 12);
    const back = joystickOrbit(base, { rotate: 0, tilt: -1 }, 0.02);
    expect(back.polar).toBeGreaterThan(base.polar);
    expectOnlyRotateTilt(base, forward);
    expectOnlyRotateTilt(base, back);
  });

  it('clamps the tilt to the orbit limits however long it is held', () => {
    let o = base;
    for (let i = 0; i < 500; i++) o = joystickOrbit(o, { rotate: 0, tilt: 1 }, 0.05);
    expect(o.polar).toBe(MIN_POLAR);
    for (let i = 0; i < 500; i++) o = joystickOrbit(o, { rotate: 0, tilt: -1 }, 0.05);
    expect(o.polar).toBe(MAX_POLAR);
    expect(nudgeOrbit(base, 0, 10).polar).toBe(MIN_POLAR);
    expect(nudgeOrbit(base, 0, -10).polar).toBe(MAX_POLAR);
  });

  it('keeps every invariant for any input and frame time', () => {
    fc.assert(
      fc.property(num(-3, 3), num(-3, 3), num(-1, 10), num(-1, 1), (rotate, tilt, dt, a) => {
        const from = { ...base, azimuth: a };
        const next = joystickOrbit(from, { rotate, tilt }, dt);
        expect(next.polar).toBeGreaterThanOrEqual(MIN_POLAR);
        expect(next.polar).toBeLessThanOrEqual(MAX_POLAR);
        expect(next.azimuth).toBeGreaterThan(-Math.PI - 1e-12);
        expect(next.azimuth).toBeLessThanOrEqual(Math.PI);
        // A stalled frame moves no further than MAX_FRAME_SECONDS at full deflection.
        const turned = Math.abs(Math.atan2(Math.sin(next.azimuth - a), Math.cos(next.azimuth - a)));
        expect(turned).toBeLessThanOrEqual(JOYSTICK_ROTATE_RATE * MAX_FRAME_SECONDS + 1e-9);
        expectOnlyRotateTilt(from, next);
      }),
    );
  });

  it('steps by the rotate buttons and arrow keys', () => {
    expect(nudgeOrbit(base, ROTATE_STEP, 0).azimuth).toBeCloseTo(base.azimuth - ROTATE_STEP, 10);
    expect(joystickKeyStep('ArrowRight')).toEqual({ rotate: ROTATE_STEP, tilt: 0 });
    expect(joystickKeyStep('ArrowLeft')).toEqual({ rotate: -ROTATE_STEP, tilt: 0 });
    expect(joystickKeyStep('ArrowUp')).toEqual({ rotate: 0, tilt: TILT_STEP });
    expect(joystickKeyStep('ArrowDown')).toEqual({ rotate: 0, tilt: -TILT_STEP });
    expect(joystickKeyStep('PageUp')).toBeNull();
  });
});

describe('camera joystick store', () => {
  beforeEach(() => {
    cameraJoystickStore.setState(cameraJoystickStore.getInitialState());
  });

  it('accumulates steps until the camera takes them', () => {
    cameraJoystickStore.getState().step(ROTATE_STEP, 0);
    cameraJoystickStore.getState().step(ROTATE_STEP, TILT_STEP);
    expect(cameraJoystickStore.getState().takePending()).toEqual({
      rotate: 2 * ROTATE_STEP,
      tilt: TILT_STEP,
    });
    expect(cameraJoystickStore.getState().takePending()).toEqual({ rotate: 0, tilt: 0 });
  });

  it('holds the knob input and counts mouse moves', () => {
    cameraJoystickStore.getState().setInput({ rotate: 0.5, tilt: 0 });
    expect(cameraJoystickStore.getState().input).toEqual({ rotate: 0.5, tilt: 0 });
    cameraJoystickStore.getState().setInput({ rotate: 0, tilt: 0 });
    expect(cameraJoystickStore.getState().input).toBe(IDLE_INPUT);
    cameraJoystickStore.getState().mouseMoved();
    expect(cameraJoystickStore.getState().mouseMoves).toBe(1);
  });
});
