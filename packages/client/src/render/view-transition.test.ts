import { describe, expect, it } from 'vitest';
import { defaultOrbit } from './camera-3d.js';
import {
  easeInOut,
  lerpOrbit,
  MAX_TWEEN_MS,
  orbitToView2d,
  TWEEN_MS,
  tweenProgress,
  view2dToOrbit,
} from './view-transition.js';

describe('view tween maths', () => {
  it('runs for at most 300 ms', () => {
    expect(TWEEN_MS).toBeLessThanOrEqual(300);
    expect(tweenProgress(MAX_TWEEN_MS, 10_000)).toBe(1);
    expect(tweenProgress(0, TWEEN_MS)).toBe(0);
    expect(tweenProgress(TWEEN_MS, TWEEN_MS)).toBe(1);
    expect(tweenProgress(5, 0)).toBe(1);
  });

  it('eases monotonically with exact endpoints', () => {
    let prev = -1;
    for (let i = 0; i <= 200; i++) {
      const v = easeInOut(i / 200);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(easeInOut(-1)).toBe(0);
    expect(easeInOut(2)).toBe(1);
    expect(easeInOut(Number.NaN)).toBe(0);
  });

  it('maps a 2D view to a top-down orbit and back', () => {
    const view = { centerX: 3, centerZ: -7, zoom: 48 };
    const o = view2dToOrbit(view, 600);
    expect(o.targetX).toBe(3);
    expect(o.targetZ).toBe(-7);
    expect(o.azimuth).toBe(0);
    const back = orbitToView2d(o, 600);
    expect(back.centerX).toBe(3);
    expect(back.centerZ).toBe(-7);
    expect(back.zoom).toBeCloseTo(48, 6);
  });

  it('zooming out in 2D moves the matching camera further away', () => {
    expect(view2dToOrbit({ centerX: 0, centerZ: 0, zoom: 16 }, 600).distance).toBeGreaterThan(
      view2dToOrbit({ centerX: 0, centerZ: 0, zoom: 64 }, 600).distance,
    );
  });

  it('lerps orbits with exact endpoints and monotonic polar', () => {
    const a = view2dToOrbit({ centerX: 1, centerZ: 2, zoom: 48 }, 600);
    const b = defaultOrbit({ minX: 0, maxX: 8, minZ: 0, maxZ: 8 });
    expect(lerpOrbit(a, b, 0)).toBe(a);
    expect(lerpOrbit(a, b, 1)).toBe(b);
    let prevPolar = a.polar;
    for (let i = 1; i < 20; i++) {
      const m = lerpOrbit(a, b, i / 20);
      expect(m.polar).toBeGreaterThanOrEqual(prevPolar);
      prevPolar = m.polar;
      expect(m.distance).toBeGreaterThan(0);
    }
  });

  it('takes the short way round in azimuth', () => {
    const base = defaultOrbit(null);
    const mid = lerpOrbit({ ...base, azimuth: 3 }, { ...base, azimuth: -3 }, 0.5);
    expect(Math.abs(mid.azimuth)).toBeGreaterThan(2.9);
  });
});
