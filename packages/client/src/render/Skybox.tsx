import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { BackSide, BufferAttribute, Color, SphereGeometry, SRGBColorSpace, type Mesh } from 'three';
import type { AssetRef } from '@mythic/shared';
import { assetUrl } from '../assets/asset-url.js';
import { domeColors, type BackgroundSpec } from './skybox-model.js';
import { useMapTexture } from './use-texture.js';

// Inside the 3D camera's far plane (2000) so the dome is never clipped.
const DOME_RADIUS = 900;
// Host origin for assets; '' = same origin (the dev server proxies `/assets`), like MapImage.
const ASSET_BASE_URL = '';

/**
 * ENV-07: the 3D sky. An uploaded image is drawn on the dome; absent, still loading, or failed to
 * load, it falls back to the vertical colour/gradient. It is re-centred on the camera every frame
 * so pan/orbit never reveals its edge, draws first with no depth test/write so it cannot z-fight
 * with the board.
 */
export function Skybox({ spec, skybox }: { spec: BackgroundSpec; skybox?: AssetRef }) {
  const mesh = useRef<Mesh>(null);
  // A library ref (D16) has no URL yet, so it behaves like an error and the gradient shows.
  const texture = useMapTexture(assetUrl(ASSET_BASE_URL, skybox));
  const textured = skybox !== undefined && texture.status === 'ready';
  const geometry = useMemo(() => {
    const g = new SphereGeometry(DOME_RADIUS, 32, 16);
    const pos = g.getAttribute('position');
    const ys = Array.from({ length: pos.count }, (_, i) => pos.getY(i) / DOME_RADIUS);
    const colors = domeColors(spec, ys);
    // The material skips tone mapping, and three outputs linear values through the sRGB curve,
    // so the sRGB picker colours must be linearised or the sky renders washed out.
    const c = new Color();
    for (let i = 0; i < colors.length; i += 3) {
      c.setRGB(colors[i] ?? 0, colors[i + 1] ?? 0, colors[i + 2] ?? 0, SRGBColorSpace);
      colors[i] = c.r;
      colors[i + 1] = c.g;
      colors[i + 2] = c.b;
    }
    g.setAttribute('color', new BufferAttribute(colors, 3));
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
        {...(textured ? { map: texture.texture } : { vertexColors: true })}
        side={BackSide}
        depthTest={false}
        depthWrite={false}
        fog={false}
        toneMapped={false}
      />
    </mesh>
  );
}
