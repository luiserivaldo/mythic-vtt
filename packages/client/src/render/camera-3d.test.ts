import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  clampOrbit,
  clampTargetToGround,
  dampVelocity,
  defaultOrbit,
  dolly,
  GROUND_EPSILON,
  groundAxes,
  MAX_DISTANCE,
  MAX_POLAR,
  MIN_DISTANCE,
  MIN_POLAR,
  orbitByPixels,
  orbitFromPositionTarget,
  orbitOffset,
  orbitPosition,
  panOnGround,
  pinchUpdate,
  wheelFactor,
  type Orbit3D,
} from './camera-3d.js';

const num = (min: number, max: number) => fc.double({ min, max, noNaN: true });
const orbitArb: fc.Arbitrary<Orbit3D> = fc.record({
  targetX: num(-500, 500),
  targetY: num(-50, 50),
  targetZ: num(-500, 500),
  azimuth: num(-20, 20),
  polar: num(-5, 5),
  distance: num(-10, 1000),
});
const base = defaultOrbit(null);

function invariants(o: Orbit3D) {
  const p = orbitPosition(o);
  expect(o.polar).toBeGreaterThanOrEqual(MIN_POLAR - 1e-12);
  expect(o.polar).toBeLessThanOrEqual(MAX_POLAR + 1e-12);
  expect(o.distance).toBeGreaterThanOrEqual(MIN_DISTANCE);
  expect(o.distance).toBeLessThanOrEqual(MAX_DISTANCE);
  expect(o.targetY).toBeGreaterThanOrEqual(GROUND_EPSILON);
  expect(p.y).toBeGreaterThanOrEqual(GROUND_EPSILON - 1e-9);
  expect(Math.abs(o.azimuth)).toBeLessThanOrEqual(Math.PI + 1e-12);
}

describe('camera-3d', () => {
  it('clampOrbit always satisfies every invariant', () => {
    fc.assert(
      fc.property(orbitArb, (o) => {
        invariants(clampOrbit(o));
      }),
    );
  });

  it('clampOrbit is idempotent', () => {
    fc.assert(
      fc.property(orbitArb, (o) => {
        const once = clampOrbit(o);
        expect(clampOrbit(once)).toEqual(once);
      }),
    );
  });

  it('survives non-finite input', () => {
    invariants(
      clampOrbit({ ...base, targetX: NaN, polar: Infinity, distance: -Infinity, azimuth: NaN }),
    );
  });

  it('offset length equals distance and camera stays above the ground at the tilt limits', () => {
    fc.assert(
      fc.property(
        num(-10, 10),
        num(MIN_POLAR, MAX_POLAR),
        num(MIN_DISTANCE, MAX_DISTANCE),
        (a, p, d) => {
          const off = orbitOffset({ azimuth: a, polar: p, distance: d });
          expect(Math.hypot(off.x, off.y, off.z)).toBeCloseTo(d, 6);
          expect(off.y).toBeGreaterThan(0);
        },
      ),
    );
  });

  it('round-trips position/target through spherical coordinates', () => {
    fc.assert(
      fc.property(orbitArb, (raw) => {
        const o = clampOrbit(raw);
        const back = orbitFromPositionTarget(orbitPosition(o), {
          x: o.targetX,
          y: o.targetY,
          z: o.targetZ,
        });
        expect(back.polar).toBeCloseTo(o.polar, 6);
        expect(back.distance).toBeCloseTo(o.distance, 6);
        expect(Math.cos(back.azimuth)).toBeCloseTo(Math.cos(o.azimuth), 6);
        expect(Math.sin(back.azimuth)).toBeCloseTo(Math.sin(o.azimuth), 6);
      }),
    );
  });

  it('orbiting never changes the focus and never leaves the tilt range, however far dragged', () => {
    fc.assert(
      fc.property(num(-1e5, 1e5), num(-1e5, 1e5), (dx, dy) => {
        const next = orbitByPixels(base, dx, dy);
        invariants(next);
        expect([next.targetX, next.targetY, next.targetZ]).toEqual([
          base.targetX,
          base.targetY,
          base.targetZ,
        ]);
      }),
    );
  });

  it('azimuth is free: a full horizontal drag wraps instead of clamping', () => {
    const a = orbitByPixels({ ...base, azimuth: 0 }, -(Math.PI * 2) / 0.006 - 10, 0);
    expect(Math.abs(a.azimuth)).toBeLessThan(Math.PI);
    const b = orbitByPixels({ ...base, azimuth: 0 }, -100, 0);
    expect(b.azimuth).toBeGreaterThan(0);
  });

  it('drag down raises the camera (tilts toward top-down)', () => {
    const next = orbitByPixels(base, 0, 50);
    expect(next.polar).toBeLessThan(base.polar);
  });

  it('pan keeps focus height, moves only on the ground plane, and content follows the pointer', () => {
    fc.assert(
      fc.property(orbitArb, num(-500, 500), num(-500, 500), (raw, dx, dy) => {
        const o = clampOrbit(raw);
        const next = panOnGround(o, dx, dy, 600);
        expect(next.targetY).toBe(o.targetY);
        expect(next.azimuth).toBe(o.azimuth);
        expect(next.polar).toBe(o.polar);
        invariants(next);
      }),
    );
    // Dragging right with azimuth 0 (camera on +Z looking at -Z, right = +X) moves focus to -X.
    const next = panOnGround({ ...base, azimuth: 0, targetX: 0, targetZ: 0 }, 100, 0, 600);
    expect(next.targetX).toBeLessThan(0);
    expect(next.targetZ).toBeCloseTo(0);
  });

  it('ground axes are orthonormal', () => {
    fc.assert(
      fc.property(num(-10, 10), (a) => {
        const { right, forward } = groundAxes(a);
        expect(Math.hypot(right.x, right.y)).toBeCloseTo(1);
        expect(right.x * forward.x + right.y * forward.y).toBeCloseTo(0);
      }),
    );
  });

  it('dolly stays within bounds and moves the right way', () => {
    fc.assert(
      fc.property(orbitArb, num(0.001, 1000), (raw, f) => {
        invariants(dolly(clampOrbit(raw), f));
      }),
    );
    expect(dolly(base, 2).distance).toBeGreaterThanOrEqual(base.distance);
    expect(dolly(base, 0.5).distance).toBeLessThanOrEqual(base.distance);
    expect(dolly(base, NaN)).toBe(base);
    expect(wheelFactor({ deltaY: 100, deltaMode: 0 })).toBeGreaterThan(1);
    expect(wheelFactor({ deltaY: -100, deltaMode: 0 })).toBeLessThan(1);
  });

  it('pinch apart zooms in, together zooms out, and drift pans', () => {
    const vp = 600;
    const apart = pinchUpdate(
      base,
      vp,
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      [
        { x: -50, y: 0 },
        { x: 150, y: 0 },
      ],
    );
    expect(apart.distance).toBeLessThan(base.distance);
    const together = pinchUpdate(
      base,
      vp,
      [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
      ],
      [
        { x: 50, y: 0 },
        { x: 100, y: 0 },
      ],
    );
    expect(together.distance).toBeGreaterThan(base.distance);
    const drift = pinchUpdate(
      base,
      vp,
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      [
        { x: 40, y: 30 },
        { x: 140, y: 30 },
      ],
    );
    expect(drift.targetX !== base.targetX || drift.targetZ !== base.targetZ).toBe(true);
  });

  it('default view is isometric-ish, frames the bounds and centres on them', () => {
    const o = defaultOrbit({ minX: 0, maxX: 40, minZ: 0, maxZ: 30 });
    invariants(o);
    expect(o.targetX).toBeCloseTo(20);
    expect(o.targetZ).toBeCloseTo(15);
    expect(o.polar).toBeGreaterThan(MIN_POLAR);
    expect(o.polar).toBeLessThan(MAX_POLAR);
    expect(o.distance).toBeGreaterThan(
      defaultOrbit({ minX: 0, maxX: 4, minZ: 0, maxZ: 4 }).distance,
    );
    invariants(defaultOrbit(null));
  });

  it('damping decays to exactly zero', () => {
    let v = 3;
    for (let i = 0; i < 200 && v !== 0; i++) v = dampVelocity(v, 1 / 60);
    expect(v).toBe(0);
  });
});

describe('clampTargetToGround (D37)', () => {
  const ground = { minX: 0, maxX: 40, minZ: 0, maxZ: 30 };
  it('clamps the focus to the canvas and leaves null alone', () => {
    const o = defaultOrbit(ground);
    expect(clampTargetToGround({ ...o, targetX: -50, targetZ: 99 }, ground)).toMatchObject({
      targetX: 0,
      targetZ: 30,
    });
    expect(clampTargetToGround({ ...o, targetX: -50 }, null).targetX).toBe(-50);
  });
  it('defaultOrbit frames the canvas centre', () => {
    expect(defaultOrbit(ground)).toMatchObject({ targetX: 20, targetZ: 15 });
  });
});
