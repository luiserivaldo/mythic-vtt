import { describe, expect, it } from 'vitest';
import { billboardYaw, labelAnchor3d, standeeDimensions } from './token-standee.js';

describe('standeeDimensions', () => {
  it('scales proportionally with footprint', () => {
    const m = standeeDimensions(1);
    const h = standeeDimensions(3);
    expect(h.height).toBeCloseTo(m.height * 3);
    expect(h.width).toBeCloseTo(m.width * 3);
    expect(standeeDimensions(0.5).height).toBeLessThan(m.height);
  });
  it('falls back to one cell for malformed sizes', () => {
    expect(standeeDimensions(Number.NaN)).toEqual(standeeDimensions(1));
    expect(standeeDimensions(-2)).toEqual(standeeDimensions(1));
  });
  it('base fits within the footprint', () => {
    expect(standeeDimensions(2).baseRadius).toBeLessThanOrEqual(1);
  });
});

describe('billboardYaw', () => {
  const t = { x: 0, z: 0 };
  it('faces +Z camera with zero yaw and rotates with azimuth', () => {
    expect(billboardYaw(t, { x: 0, z: 5 })).toBeCloseTo(0);
    expect(billboardYaw(t, { x: 5, z: 0 })).toBeCloseTo(Math.PI / 2);
    expect(Math.abs(billboardYaw(t, { x: 0, z: -5 }))).toBeCloseTo(Math.PI);
  });
  it('resulting facing direction points at the camera', () => {
    for (const [x, z] of [
      [3, 4],
      [-2, 7],
      [-5, -1],
      [1, -9],
    ] as const) {
      const yaw = billboardYaw(t, { x, z });
      const len = Math.hypot(x, z);
      expect(Math.sin(yaw)).toBeCloseTo(x / len);
      expect(Math.cos(yaw)).toBeCloseTo(z / len);
    }
  });
  it('keeps the fallback when directly overhead or non-finite', () => {
    expect(billboardYaw(t, { x: 0, z: 0 }, 1.2)).toBe(1.2);
    expect(billboardYaw(t, { x: Number.NaN, z: 1 }, 0.4)).toBe(0.4);
  });
});

describe('labelAnchor3d', () => {
  it('sits above the standee top and grows with size', () => {
    const a = labelAnchor3d(1);
    expect(a[1]).toBeGreaterThan(standeeDimensions(1).height);
    expect(labelAnchor3d(4)[1]).toBeGreaterThan(a[1]);
  });
});
