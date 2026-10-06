import {
  primitiveProfileHeight,
  surfaceHeightAt,
  type AoEShape,
  type Quat,
  type Vec3,
  type WalkableSurface,
} from '@mythic/shared';

export interface Volume {
  shape: AoEShape;
  position: Vec3;
  rotation: Quat;
}

export type RingSegment = readonly [Vec3, Vec3];
const EPS = 1e-8;

export function rotatePoint(p: Vec3, q: Quat): Vec3 {
  const tx = 2 * (q.y * p.z - q.z * p.y);
  const ty = 2 * (q.z * p.x - q.x * p.z);
  const tz = 2 * (q.x * p.y - q.y * p.x);
  return {
    x: p.x + q.w * tx + q.y * tz - q.z * ty,
    y: p.y + q.w * ty + q.z * tx - q.x * tz,
    z: p.z + q.w * tz + q.x * ty - q.y * tx,
  };
}

export function shellDimensions(shape: AoEShape): {
  width: number;
  height: number;
  depth: number;
  offsetZ: number;
} {
  switch (shape.kind) {
    case 'sphere':
      return {
        width: shape.radius * 2,
        height: shape.radius * 2,
        depth: shape.radius * 2,
        offsetZ: 0,
      };
    case 'cylinder':
      return { width: shape.radius * 2, height: shape.height, depth: shape.radius * 2, offsetZ: 0 };
    case 'cone':
      return {
        width: shape.radius * 2,
        height: shape.radius * 2,
        depth: shape.length,
        offsetZ: shape.length / 2,
      };
    case 'cube':
      return { width: shape.size, height: shape.size, depth: shape.size, offsetZ: 0 };
    case 'line':
      return {
        width: shape.width,
        height: shape.height,
        depth: shape.length,
        offsetZ: shape.length / 2,
      };
  }
}

export function containsVolume(volume: Volume, point: Vec3): boolean {
  const { position, rotation, shape } = volume;
  const p = rotatePoint(
    { x: point.x - position.x, y: point.y - position.y, z: point.z - position.z },
    { x: -rotation.x, y: -rotation.y, z: -rotation.z, w: rotation.w },
  );
  switch (shape.kind) {
    case 'sphere':
      return p.x * p.x + p.y * p.y + p.z * p.z <= shape.radius ** 2 + EPS;
    case 'cylinder':
      return (
        p.x * p.x + p.z * p.z <= shape.radius ** 2 + EPS && Math.abs(p.y) <= shape.height / 2 + EPS
      );
    case 'cone':
      return (
        p.z >= -EPS &&
        p.z <= shape.length + EPS &&
        p.x * p.x + p.y * p.y <= (shape.length ? (shape.radius * p.z) / shape.length : 0) ** 2 + EPS
      );
    case 'cube':
      return (
        Math.abs(p.x) <= shape.size / 2 + EPS &&
        Math.abs(p.y) <= shape.size / 2 + EPS &&
        Math.abs(p.z) <= shape.size / 2 + EPS
      );
    case 'line':
      return (
        Math.abs(p.x) <= shape.width / 2 + EPS &&
        Math.abs(p.y) <= shape.height / 2 + EPS &&
        p.z >= -EPS &&
        p.z <= shape.length + EPS
      );
  }
}

/** A top-down silhouette at the AoE origin height, also used for the 2D fill. */
export function sectionPolygon(volume: Volume, segments = 48): Vec3[] {
  const { shape, position, rotation } = volume;
  let points: Vec3[];
  if (shape.kind === 'sphere' || shape.kind === 'cylinder') {
    points = Array.from({ length: segments }, (_, i) => {
      const a = (2 * Math.PI * i) / segments;
      return { x: Math.cos(a) * shape.radius, y: 0, z: Math.sin(a) * shape.radius };
    });
  } else if (shape.kind === 'cone') {
    points = [
      { x: 0, y: 0, z: 0 },
      { x: shape.radius, y: 0, z: shape.length },
      { x: -shape.radius, y: 0, z: shape.length },
    ];
  } else {
    const width = shape.kind === 'cube' ? shape.size : shape.width;
    const start = shape.kind === 'cube' ? -shape.size / 2 : 0;
    const end = shape.kind === 'cube' ? shape.size / 2 : shape.length;
    points = [
      { x: -width / 2, y: 0, z: start },
      { x: width / 2, y: 0, z: start },
      { x: width / 2, y: 0, z: end },
      { x: -width / 2, y: 0, z: end },
    ];
  }
  return points.map((p) => {
    const r = rotatePoint(p, rotation);
    return { x: position.x + r.x, y: position.y + r.y, z: position.z + r.z };
  });
}

/** Marching squares over the actual surface profile; segments sit just above its top. */
export function surfaceRings(
  volume: Volume,
  walkables: readonly WalkableSurface[],
  step = 0.2,
): RingSegment[] {
  const d = shellDimensions(volume.shape);
  const corners: Vec3[] = [];
  for (const x of [-d.width / 2, d.width / 2])
    for (const y of [-d.height / 2, d.height / 2])
      for (const z of [d.offsetZ - d.depth / 2, d.offsetZ + d.depth / 2]) {
        const r = rotatePoint({ x, y, z }, volume.rotation);
        corners.push({
          x: volume.position.x + r.x,
          y: volume.position.y + r.y,
          z: volume.position.z + r.z,
        });
      }
  const minX = Math.min(...corners.map((p) => p.x)) - step;
  const maxX = Math.max(...corners.map((p) => p.x)) + step;
  const minZ = Math.min(...corners.map((p) => p.z)) - step;
  const maxZ = Math.max(...corners.map((p) => p.z)) + step;
  const nx = Math.max(1, Math.min(256, Math.ceil((maxX - minX) / step)));
  const nz = Math.max(1, Math.min(256, Math.ceil((maxZ - minZ) / step)));
  const dx = (maxX - minX) / nx;
  const dz = (maxZ - minZ) / nz;
  const result: RingSegment[] = [];
  for (const surface of [null, ...walkables]) {
    const sample = (x: number, z: number) => {
      if (surface && primitiveProfileHeight(surface, x, z) === undefined) return false;
      const y = surface ? surfaceHeightAt(x, z, [surface]) : 0;
      return containsVolume(volume, { x, y, z });
    };
    const heights = (x: number, z: number) =>
      surface ? surfaceHeightAt(x, z, [surface]) + 0.025 : 0.025;
    for (let iz = 0; iz < nz; iz++)
      for (let ix = 0; ix < nx; ix++) {
        const x = minX + ix * dx;
        const z = minZ + iz * dz;
        const flags = [sample(x, z), sample(x + dx, z), sample(x + dx, z + dz), sample(x, z + dz)];
        const edges: Vec3[] = [];
        const coords: [number, number][] = [
          [x, z],
          [x + dx, z],
          [x + dx, z + dz],
          [x, z + dz],
        ];
        for (let edge = 0; edge < 4; edge++) {
          const next = (edge + 1) % 4;
          if (flags[edge] === flags[next]) continue;
          const a = coords[edge];
          const b = coords[next];
          if (!a || !b) continue;
          const mx = (a[0] + b[0]) / 2;
          const mz = (a[1] + b[1]) / 2;
          edges.push({ x: mx, y: heights(mx, mz), z: mz });
        }
        for (let i = 0; i + 1 < edges.length; i += 2) {
          const a = edges[i];
          const b = edges[i + 1];
          if (a && b) result.push([a, b]);
        }
      }
  }
  return result;
}
