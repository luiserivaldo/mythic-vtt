import {
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  SphereGeometry,
  BoxGeometry,
} from 'three';
import {
  primitiveFootprint,
  primitiveTopHeight,
  wedgeMesh,
  type PrimitiveKind,
  type Point2,
} from '@mythic/shared';
import type { RenderShape } from './scene-model.js';

// Unit geometries span x,z in [-0.5, 0.5] and y in [0, 1] (base at y = 0). The mesh scale then
// carries the entity's width/height/depth, so one geometry per kind is shared by every entity.
const cache = new Map<PrimitiveKind, BufferGeometry>();

function buildUnit(kind: PrimitiveKind): BufferGeometry {
  switch (kind) {
    case 'box':
    case 'plane':
      return new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    case 'cylinder':
      return new CylinderGeometry(0.5, 0.5, 1, 32).translate(0, 0.5, 0);
    case 'cone':
      return new ConeGeometry(0.5, 1, 32).translate(0, 0.5, 0);
    case 'pyramid':
      // Four radial segments put the base corners on the axes; turn them onto the square's corners.
      return new ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0);
    case 'sphere':
      return new SphereGeometry(0.5, 32, 16).translate(0, 0.5, 0);
    case 'wedge': {
      const mesh = wedgeMesh(1, 1, 1);
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(mesh.positions, 3));
      geometry.setIndex(mesh.indices);
      geometry.computeVertexNormals();
      return geometry;
    }
  }
}

export function unitGeometry(kind: PrimitiveKind): BufferGeometry {
  let geometry = cache.get(kind);
  if (!geometry) {
    geometry = buildUnit(kind);
    cache.set(kind, geometry);
  }
  return geometry;
}

/** Flat triangle fan of a convex footprint, lying in the XZ plane at y = 0. */
export function footprintFill(points: readonly Point2[]): BufferGeometry {
  const positions: number[] = [];
  for (const p of points) positions.push(p.x, 0, p.z);
  const indices: number[] = [];
  for (let i = 1; i < points.length - 1; i++) indices.push(0, i, i + 1);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

/** Closed outline for a LineLoop. */
export function footprintOutline(points: readonly Point2[]): BufferGeometry {
  const positions: number[] = [];
  for (const p of points) positions.push(p.x, 0, p.z);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return geometry;
}

/** Footprint of a render shape, rotated by its yaw (2D mode). */
export function shapeFootprint(shape: RenderShape): Point2[] {
  return primitiveFootprint(shape.kind, shape.scale, shape.yaw);
}

/** Elevation of the drawn 2D surface: just under the walkable top so tokens on it stay visible. */
export function surfaceDrawHeight(shape: RenderShape): number {
  return Math.max(primitiveTopHeight(shape.kind, shape.height) - 0.01, 0);
}

const FALLBACK_COLOR = '#8a96a5';
/** Colours are free-form strings in the schema; anything three.js can't parse falls back. */
export function safeColor(color: string): string {
  return /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color) ? color : FALLBACK_COLOR;
}
