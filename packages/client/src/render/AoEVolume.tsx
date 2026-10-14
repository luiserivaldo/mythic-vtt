import { useEffect, useMemo } from 'react';
import {
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  SphereGeometry,
  Vector3,
} from 'three';
import type { AoEShape, WalkableSurface } from '@mythic/shared';
import { sectionPolygon, shellDimensions, surfaceRings, type Volume } from './aoe-geometry.js';
import type { RenderMode } from './PrimitiveMesh.js';

function shellGeometry(shape: AoEShape): BufferGeometry {
  const d = shellDimensions(shape);
  switch (shape.kind) {
    case 'sphere':
      return new SphereGeometry(shape.radius, 32, 16);
    case 'cylinder':
      return new CylinderGeometry(shape.radius, shape.radius, shape.height, 48);
    case 'cone':
      return new ConeGeometry(shape.radius, shape.length, 48)
        .rotateX(-Math.PI / 2)
        .translate(0, 0, d.offsetZ);
    case 'cube':
      return new BoxGeometry(shape.size, shape.size, shape.size);
    case 'line':
      return new BoxGeometry(shape.width, shape.height, shape.length).translate(0, 0, d.offsetZ);
  }
}

function sectionGeometry(volume: Volume): { fill: BufferGeometry; outline: BufferGeometry } {
  const points = sectionPolygon(volume);
  const fill = new BufferGeometry();
  const vertices: number[] = [];
  for (let i = 1; i + 1 < points.length; i++) {
    for (const p of [points[0], points[i], points[i + 1]])
      if (p) vertices.push(p.x, p.y + 0.03, p.z);
  }
  fill.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  const outline = new BufferGeometry().setFromPoints(
    points.map((p) => new Vector3(p.x, p.y + 0.04, p.z)),
  );
  return { fill, outline };
}

function ringGeometry(volume: Volume, walkables: readonly WalkableSurface[]): BufferGeometry {
  const positions: number[] = [];
  for (const [a, b] of surfaceRings(volume, walkables))
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
  return new BufferGeometry().setAttribute('position', new Float32BufferAttribute(positions, 3));
}

/** MEAS-06: passive visual only. Every mesh and line opts out of raycasting. */
export function AoEVolume({
  volume,
  walkables,
  mode,
  renderOrder,
}: {
  volume: Volume;
  walkables: readonly WalkableSurface[];
  mode: RenderMode;
  renderOrder: number;
}) {
  const shell = useMemo(() => shellGeometry(volume.shape), [volume.shape]);
  const section = useMemo(() => sectionGeometry(volume), [volume]);
  const rings = useMemo(() => ringGeometry(volume, walkables), [volume, walkables]);
  useEffect(
    () => () => {
      shell.dispose();
      section.fill.dispose();
      section.outline.dispose();
      rings.dispose();
    },
    [shell, section, rings],
  );
  const color = volume.shape.color;
  // Even elevated volumes retain their 2D section. Surface rings communicate where they touch terrain.
  return (
    <>
      {mode === '3d' ? (
        <mesh
          geometry={shell}
          position={[volume.position.x, volume.position.y, volume.position.z]}
          quaternion={[volume.rotation.x, volume.rotation.y, volume.rotation.z, volume.rotation.w]}
          renderOrder={renderOrder}
          raycast={() => null}
        >
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.095}
            depthWrite={false}
            side={DoubleSide}
          />
        </mesh>
      ) : (
        <>
          <mesh geometry={section.fill} renderOrder={renderOrder} raycast={() => null}>
            <meshBasicMaterial
              color={color}
              transparent
              opacity={0.18}
              depthWrite={false}
              side={DoubleSide}
            />
          </mesh>
          <lineLoop geometry={section.outline} renderOrder={renderOrder + 1} raycast={() => null}>
            <lineBasicMaterial color={color} transparent opacity={0.9} depthWrite={false} />
          </lineLoop>
        </>
      )}
      <lineSegments geometry={rings} renderOrder={renderOrder + 2} raycast={() => null}>
        <lineBasicMaterial color={color} transparent opacity={1} depthWrite={false} />
      </lineSegments>
    </>
  );
}
