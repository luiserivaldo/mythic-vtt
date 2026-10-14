import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  dropElevation,
  surfaceHeightAt,
  walkableFromEntity,
  type WalkableSurface,
} from './surface-height.js';

const mk = (
  kind: WalkableSurface['kind'],
  scale: [number, number, number],
  pos: [number, number, number] = [0, 0, 0],
  yaw = 0,
): WalkableSurface => ({
  kind,
  position: { x: pos[0], y: pos[1], z: pos[2] },
  scale: { x: scale[0], y: scale[1], z: scale[2] },
  yaw,
});

describe('surfaceHeightAt profiles', () => {
  it('returns ground with no walkables', () => {
    expect(surfaceHeightAt(3, 4, [])).toBe(0);
  });

  it('box and cylinder are flat', () => {
    expect(surfaceHeightAt(0.9, -0.9, [mk('box', [2, 1.5, 2])])).toBe(1.5);
    const cyl = [mk('cylinder', [2, 2, 2])];
    expect(surfaceHeightAt(0.7, 0.7, cyl)).toBe(2);
    expect(surfaceHeightAt(0.8, 0.8, cyl)).toBe(0); // inside the bounding box but outside the circle
  });

  it('plane uses its fixed thickness', () => {
    expect(surfaceHeightAt(0, 0, [mk('plane', [2, 9, 2])])).toBeCloseTo(0.02);
  });

  it('wedge ramps up toward +z', () => {
    const w = [mk('wedge', [2, 2, 4])];
    expect(surfaceHeightAt(0, -2, w)).toBeCloseTo(0);
    expect(surfaceHeightAt(0, 0, w)).toBeCloseTo(1);
    expect(surfaceHeightAt(0, 2, w)).toBeCloseTo(2);
  });

  it('wedge follows yaw (yaw pi/2 turns +z toward +x)', () => {
    const w = [mk('wedge', [2, 2, 4], [0, 0, 0], Math.PI / 2)];
    // local +z maps to world +x under the primitives.ts rotation sense.
    expect(surfaceHeightAt(2, 0, w)).toBeCloseTo(2);
    expect(surfaceHeightAt(-2, 0, w)).toBeCloseTo(0);
  });

  it('cone peaks at the centre and falls linearly to the rim', () => {
    const c = [mk('cone', [4, 2, 4])];
    expect(surfaceHeightAt(0, 0, c)).toBeCloseTo(2);
    expect(surfaceHeightAt(1, 0, c)).toBeCloseTo(1);
    expect(surfaceHeightAt(2, 0, c)).toBeCloseTo(0);
    expect(surfaceHeightAt(2.1, 0, c)).toBe(0);
  });

  it('pyramid is square-based', () => {
    const p = [mk('pyramid', [4, 2, 4])];
    expect(surfaceHeightAt(0, 0, p)).toBeCloseTo(2);
    expect(surfaceHeightAt(1, 1, p)).toBeCloseTo(1);
    expect(surfaceHeightAt(2, 2, p)).toBeCloseTo(0);
  });

  it('sphere is a dome: full height at the centre, half at the rim', () => {
    const s = [mk('sphere', [2, 2, 2])];
    expect(surfaceHeightAt(0, 0, s)).toBeCloseTo(2);
    expect(surfaceHeightAt(1, 0, s)).toBeCloseTo(1);
  });

  it('offsets by base elevation and position', () => {
    expect(surfaceHeightAt(10, 10, [mk('box', [2, 1, 2], [10, 3, 10])])).toBe(4);
  });

  it('includes boundary points and survives zero size', () => {
    const b = [mk('box', [2, 1, 2])];
    expect(surfaceHeightAt(1, 1, b)).toBe(1);
    expect(surfaceHeightAt(1.001, 0, b)).toBe(0);
    const z = surfaceHeightAt(0, 0, [mk('box', [0, 0, 0])]);
    expect(Number.isFinite(z)).toBe(true);
  });
});

describe('stacking and current elevation', () => {
  const stack = [mk('box', [4, 1, 4]), mk('box', [2, 1, 2], [0, 1, 0])];

  it('stacked platforms sum base elevation and height', () => {
    expect(surfaceHeightAt(0, 0, stack)).toBe(2);
    expect(surfaceHeightAt(1.5, 0, stack)).toBe(1);
  });

  it('overlapping platforms take the highest', () => {
    expect(surfaceHeightAt(0, 0, [mk('box', [2, 1, 2]), mk('box', [2, 3, 2])])).toBe(3);
  });

  it('a token below a ceiling is not snapped through it', () => {
    const ceiling = [mk('box', [4, 0.5, 4], [0, 3, 0])];
    expect(surfaceHeightAt(0, 0, ceiling)).toBe(3.5);
    expect(surfaceHeightAt(0, 0, ceiling, { currentElevation: 0 })).toBe(0);
    expect(surfaceHeightAt(0, 0, ceiling, { currentElevation: 3.2 })).toBe(3.5);
  });

  it('respects maxStepUp', () => {
    const b = [mk('box', [2, 1, 2])];
    expect(surfaceHeightAt(0, 0, b, { currentElevation: 0 })).toBe(0);
    expect(surfaceHeightAt(0, 0, b, { currentElevation: 0, maxStepUp: 1 })).toBe(1);
    expect(surfaceHeightAt(0, 0, stack, { currentElevation: 1, maxStepUp: 0 })).toBe(1);
  });
});

describe('dropElevation', () => {
  const stack = [mk('box', [4, 1, 4]), mk('box', [2, 1, 2], [0, 1, 0])];
  it('lands on the highest surface at or under the drop height', () => {
    expect(dropElevation({ x: 0, y: 9, z: 0 }, stack)).toBe(2);
    expect(dropElevation({ x: 0, y: 1, z: 0 }, stack)).toBe(1);
    expect(dropElevation({ x: 0, y: 0, z: 0 }, stack)).toBe(0); // under a 1-high box, step 0.5 is not enough
    expect(dropElevation({ x: 0, y: 0.6, z: 0 }, stack)).toBe(1);
    expect(dropElevation({ x: 9, y: 5, z: 9 }, stack)).toBe(0);
  });
  it('takes the exact ramp height, not a snapped one', () => {
    expect(dropElevation({ x: 0, y: 5, z: 0.5 }, [mk('wedge', [2, 2, 4])])).toBeCloseTo(1.25);
  });
});

describe('walkableFromEntity', () => {
  const t = {
    position: { x: 1, y: 2, z: 3 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  };
  it('ignores non-walkable and shapeless entities', () => {
    expect(walkableFromEntity({ transform: t })).toBeUndefined();
    expect(
      walkableFromEntity({ transform: t, shape: { kind: 'box', color: '#fff', walkable: false } }),
    ).toBeUndefined();
    expect(
      walkableFromEntity({ transform: t, shape: { kind: 'box', color: '#fff', walkable: true } })
        ?.kind,
    ).toBe('box');
  });
});

describe('properties', () => {
  const dim = fc.double({ min: 0.2, max: 20, noNaN: true });
  const yaw = fc.double({ min: -7, max: 7, noNaN: true });

  it('wedge height is monotonic along +z and bounded by its height', () => {
    fc.assert(
      fc.property(dim, dim, dim, yaw, (w, h, d, a) => {
        const wedge = [mk('wedge', [w, h, d], [0, 0, 0], a)];
        const c = Math.cos(a);
        const s = Math.sin(a);
        let prev = -Infinity;
        for (let i = 0; i <= 10; i++) {
          const v = -d / 2 + (d * i) / 10;
          // local (0, v) -> world via forward rotation
          const e = surfaceHeightAt(s * v, c * v, wedge);
          expect(e).toBeGreaterThanOrEqual(prev - 1e-6);
          expect(e).toBeLessThanOrEqual(h + 1e-6);
          prev = e;
        }
      }),
    );
  });

  it('box top height is rotation invariant at the centre and zero far outside', () => {
    fc.assert(
      fc.property(dim, dim, dim, yaw, (w, h, d, a) => {
        const b = [mk('box', [w, h, d], [0, 0, 0], a)];
        expect(surfaceHeightAt(0, 0, b)).toBeCloseTo(h);
        expect(surfaceHeightAt(w + d + 1, 0, b)).toBe(0);
      }),
    );
  });

  it('a stacked box sits exactly on the one beneath', () => {
    fc.assert(
      fc.property(dim, dim, (h1, h2) => {
        const s = [mk('box', [4, h1, 4]), mk('box', [2, h2, 2], [0, h1, 0])];
        expect(surfaceHeightAt(0, 0, s)).toBeCloseTo(h1 + h2);
        expect(dropElevation({ x: 0, y: h1, z: 0 }, s, 100)).toBeCloseTo(h1 + h2);
      }),
    );
  });

  it('cone and pyramid never exceed their height and never go negative', () => {
    fc.assert(
      fc.property(
        dim,
        dim,
        dim,
        yaw,
        fc.double({ min: -30, max: 30, noNaN: true }),
        fc.double({ min: -30, max: 30, noNaN: true }),
        (w, h, d, a, x, z) => {
          for (const k of ['cone', 'pyramid', 'sphere'] as const) {
            const e = surfaceHeightAt(x, z, [mk(k, [w, h, d], [0, 0, 0], a)]);
            expect(e).toBeGreaterThanOrEqual(0);
            expect(e).toBeLessThanOrEqual(h + 1e-9);
          }
        },
      ),
    );
  });
});
