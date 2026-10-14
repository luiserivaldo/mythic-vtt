import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  footprintBounds,
  PLANE_THICKNESS,
  PRIMITIVE_KINDS,
  primitiveDimensions,
  primitiveFootprint,
  primitiveTopHeight,
  ROUND_FOOTPRINT_SEGMENTS,
  wedgeMesh,
  wedgeTriangleCount,
  yawFromQuaternion,
} from './primitives.js';

const size = fc.double({ min: 0.1, max: 50, noNaN: true });

describe('primitiveDimensions', () => {
  it('uses scale as bounding size and fixes plane thickness', () => {
    expect(primitiveDimensions('box', { x: 2, y: 3, z: 4 })).toEqual({
      width: 2,
      height: 3,
      depth: 4,
    });
    expect(primitiveDimensions('plane', { x: 2, y: 3, z: 4 }).height).toBe(PLANE_THICKNESS);
  });

  it('never returns zero or NaN extents', () => {
    for (const kind of PRIMITIVE_KINDS) {
      const d = primitiveDimensions(kind, { x: 0, y: -2, z: 0 });
      expect(d.width).toBeGreaterThan(0);
      expect(d.height).toBeGreaterThan(0);
      expect(d.depth).toBeGreaterThan(0);
    }
  });

  it('reports the walkable top height', () => {
    expect(primitiveTopHeight('box', 2)).toBe(2);
    expect(primitiveTopHeight('plane', 2)).toBe(PLANE_THICKNESS);
  });
});

describe('primitiveFootprint', () => {
  it('is the bounding rectangle for angular kinds', () => {
    for (const kind of ['box', 'pyramid', 'plane', 'wedge'] as const) {
      expect(primitiveFootprint(kind, { x: 2, y: 1, z: 4 })).toHaveLength(4);
    }
  });

  it('is an ellipse polygon for round kinds', () => {
    for (const kind of ['cylinder', 'cone', 'sphere'] as const) {
      const pts = primitiveFootprint(kind, { x: 2, y: 1, z: 4 });
      expect(pts).toHaveLength(ROUND_FOOTPRINT_SEGMENTS);
      const b = footprintBounds(pts);
      expect(b.maxX).toBeCloseTo(1);
      expect(b.maxZ).toBeCloseTo(2);
    }
  });

  it('a quarter turn swaps width and depth', () => {
    const yaw = Math.PI / 2;
    const b = footprintBounds(primitiveFootprint('box', { x: 2, y: 1, z: 6 }, yaw));
    expect(b.maxX - b.minX).toBeCloseTo(6);
    expect(b.maxZ - b.minZ).toBeCloseTo(2);
  });

  it('is centred on the origin for any size and yaw', () => {
    fc.assert(
      fc.property(size, size, fc.double({ min: -7, max: 7, noNaN: true }), (x, z, yaw) => {
        for (const kind of PRIMITIVE_KINDS) {
          const pts = primitiveFootprint(kind, { x, y: 1, z }, yaw);
          const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
          const cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
          expect(Math.abs(cx)).toBeLessThan(1e-9 * Math.max(1, x, z));
          expect(Math.abs(cz)).toBeLessThan(1e-9 * Math.max(1, x, z));
        }
      }),
    );
  });
});

describe('yawFromQuaternion', () => {
  it('recovers a Y rotation', () => {
    const a = 1.2;
    expect(yawFromQuaternion({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) })).toBeCloseTo(
      a,
    );
    expect(yawFromQuaternion({ x: 0, y: 0, z: 0, w: 1 })).toBe(0);
  });
});

describe('wedgeMesh', () => {
  it('is a triangular prism: 6 vertices, 8 triangles, within the box', () => {
    const m = wedgeMesh(2, 3, 4);
    expect(m.positions).toHaveLength(18);
    expect(wedgeTriangleCount()).toBe(8);
    expect(Math.max(...m.indices)).toBe(5);
    const ys = m.positions.filter((_, i) => i % 3 === 1);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(3);
  });

  it('is closed and outward-facing: signed volume equals half the box', () => {
    const w = 2;
    const h = 3;
    const d = 4;
    const m = wedgeMesh(w, h, d);
    const vertex = (index: number) => {
      const v = index * 3;
      return { x: m.positions[v] ?? 0, y: m.positions[v + 1] ?? 0, z: m.positions[v + 2] ?? 0 };
    };
    let volume = 0;
    for (let i = 0; i < m.indices.length; i += 3) {
      const a = vertex(m.indices[i] ?? 0);
      const b = vertex(m.indices[i + 1] ?? 0);
      const c = vertex(m.indices[i + 2] ?? 0);
      // Signed tetrahedron volume against the origin (divergence theorem).
      volume +=
        (a.x * (b.y * c.z - b.z * c.y) -
          a.y * (b.x * c.z - b.z * c.x) +
          a.z * (b.x * c.y - b.y * c.x)) /
        6;
    }
    expect(volume).toBeCloseTo((w * h * d) / 2);
  });
});
