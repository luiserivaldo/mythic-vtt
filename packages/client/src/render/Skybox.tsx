import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { BackSide, BufferAttribute, SphereGeometry, type Mesh } from 'three';
import { domeColors, type BackgroundSpec } from './skybox-model.js';

// Inside the 3D camera's far plane (2000) so the dome is never clipped.
const DOME_RADIUS = 900;

/**
 * ENV-07: vertical gradient dome. It is re-centred on the camera every frame so pan/orbit never
 * reveals its edge, draws first with no depth test/write so it cannot z-fight with the board.
 */
export function Skybox({ spec }: { spec: BackgroundSpec }) {
  const mesh = useRef<Mesh>(null);
  const geometry = useMemo(() => {
    const g = new SphereGeometry(DOME_RADIUS, 32, 16);
    const pos = g.getAttribute('position');
    const ys = Array.from({ length: pos.count }, (_, i) => pos.getY(i) / DOME_RADIUS);
    g.setAttribute('color', new BufferAttribute(domeColors(spec, ys), 3));
    return g;
  }, [spec]);
  useEffect(
    () => () => {
      geometry.dispose();
    },
    [geometry],
  );
  useFrame(({ camera }) => {
    mesh.current?.position.copy(camera.position);
  });
  return (
    <mesh ref={mesh} geometry={geometry} renderOrder={-1000} frustumCulled={false}>
      <meshBasicMaterial
        vertexColors
        side={BackSide}
        depthTest={false}
        depthWrite={false}
        fog={false}
        toneMapped={false}
      />
    </mesh>
  );
}
