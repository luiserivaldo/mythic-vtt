import { describe, expect, it } from 'vitest';
import { clampViewToBounds, PAN_MARGIN_CELLS, type CanvasSize, type View2D } from './camera-2d.js';
import { defaultOrbit, GROUND_EPSILON, type GroundBounds, type Orbit3D } from './camera-3d.js';
import { FOCUS_MS, focusOrbit, focusView2D, lerpView2D } from './focus.js';
import { MAX_TWEEN_MS, tweenProgress } from './view-transition.js';

const BOUNDS: CanvasSize = { width: 20, height: 10 };
const GROUND: GroundBounds = { minX: 0, maxX: 20, minZ: 0, maxZ: 10 };

describe('double-click focus maths (CAM-06)', () => {
  it('finishes the focus tween inside the 300 ms interaction budget', () => {
    expect(FOCUS_MS).toBeGreaterThan(0);
    expect(FOCUS_MS).toBeLessThanOrEqual(MAX_TWEEN_MS);
    expect(tweenProgress(0, FOCUS_MS)).toBe(0);
    expect(tweenProgress(FOCUS_MS, FOCUS_MS)).toBe(1);
  });

  it('centres the 2D view on the token and keeps the zoom', () => {
    const view: View2D = { centerX: 0, centerZ: 0, zoom: 32 };
    const focused = focusView2D(view, 14, 6, BOUNDS);
    expect(focused.centerX).toBe(14);
    expect(focused.centerZ).toBe(6);
    // Focus moves the centre only; zooming in is not part of CAM-06.
    expect(focused.zoom).toBe(32);
  });

  it('keeps the 2D centre inside the canvas margin (D37)', () => {
    const focused = focusView2D({ centerX: 0, centerZ: 0, zoom: 32 }, -50, 99, BOUNDS);
    expect(focused).toEqual(clampViewToBounds({ centerX: -50, centerZ: 99, zoom: 32 }, BOUNDS));
    expect(focused.centerX).toBe(-PAN_MARGIN_CELLS);
    expect(focused.centerZ).toBe(BOUNDS.height + PAN_MARGIN_CELLS);
  });

  it('leaves the 2D view alone for a non-finite token position', () => {
    const view: View2D = { centerX: 3, centerZ: 4, zoom: 32 };
    expect(focusView2D(view, Number.NaN, 4, BOUNDS)).toBe(view);
    expect(focusView2D(view, 4, Number.POSITIVE_INFINITY, BOUNDS)).toBe(view);
  });

  it('moves only the 3D focus, keeping the orbit pose and the token height', () => {
    const orbit: Orbit3D = {
      ...defaultOrbit(null),
      targetX: 1,
      targetZ: 2,
      azimuth: 0.7,
      polar: 0.6,
      distance: 30,
    };
    const focused = focusOrbit(orbit, 9, 0, 4, GROUND);
    expect(focused.targetX).toBe(9);
    expect(focused.targetZ).toBe(4);
    // A token on the ground is focused at its feet, not at the old focus height.
    expect(focused.targetY).toBe(GROUND_EPSILON);
    expect(focused.azimuth).toBe(0.7);
    expect(focused.polar).toBe(0.6);
    expect(focused.distance).toBe(30);
  });

  it('follows a flying token up and clamps a bogus height to the ground', () => {
    const orbit = defaultOrbit(GROUND);
    expect(focusOrbit(orbit, 9, 8, 4, GROUND).targetY).toBe(8);
    expect(focusOrbit(orbit, 9, -3, 4, GROUND).targetY).toBe(GROUND_EPSILON);
    expect(focusOrbit(orbit, 9, Number.NaN, 4, GROUND).targetY).toBe(GROUND_EPSILON);
    expect(focusOrbit(orbit, 9, Number.POSITIVE_INFINITY, 4, GROUND).targetY).toBe(GROUND_EPSILON);
  });

  it('clamps the 3D focus to the canvas and ignores a non-finite target', () => {
    const orbit = defaultOrbit(GROUND);
    expect(focusOrbit(orbit, 99, 0, -4, GROUND).targetX).toBe(GROUND.maxX);
    expect(focusOrbit(orbit, 99, 0, -4, GROUND).targetZ).toBe(GROUND.minZ);
    // An unknown canvas extent is not a reason to fly the camera away.
    expect(focusOrbit(orbit, 99, 0, 99, null).targetX).toBe(99);
    expect(focusOrbit(orbit, Number.NaN, 0, 0, GROUND)).toBe(orbit);
    expect(focusOrbit(orbit, 3, 0, Number.NEGATIVE_INFINITY, GROUND)).toBe(orbit);
  });

  it('interpolates a 2D view with exact, monotonic endpoints', () => {
    const a: View2D = { centerX: 0, centerZ: 0, zoom: 16 };
    const b: View2D = { centerX: 10, centerZ: -4, zoom: 16 };
    expect(lerpView2D(a, b, 0)).toBe(a);
    expect(lerpView2D(a, b, 1)).toBe(b);
    expect(lerpView2D(a, b, -1)).toBe(a);
    expect(lerpView2D(a, b, Number.NaN)).toBe(a);
    const mid = lerpView2D(a, b, 0.5);
    expect(mid.centerX).toBe(5);
    expect(mid.centerZ).toBe(-2);
    expect(mid.zoom).toBe(16);
    let previous = Number.NEGATIVE_INFINITY;
    for (let i = 0; i <= 20; i++) {
      const centerX = lerpView2D(a, b, i / 20).centerX;
      expect(centerX).toBeGreaterThanOrEqual(previous);
      previous = centerX;
    }
  });

  it('lands exactly on the target when the tween finishes', () => {
    const from: View2D = { centerX: 2, centerZ: 8, zoom: 48 };
    const to = focusView2D(from, 15, 3, BOUNDS);
    expect(lerpView2D(from, to, tweenProgress(FOCUS_MS, FOCUS_MS))).toBe(to);
  });
});
