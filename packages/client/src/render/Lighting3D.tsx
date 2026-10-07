import { DEFAULT_3D_LIGHTING } from './lighting.js';

/** Neutral fill plus one key light. Mounted only while the board is rendered in 3D. */
export function Lighting3D() {
  return (
    <>
      <ambientLight intensity={DEFAULT_3D_LIGHTING.ambientIntensity} />
      <directionalLight
        position={[...DEFAULT_3D_LIGHTING.directionalPosition]}
        intensity={DEFAULT_3D_LIGHTING.directionalIntensity}
      />
    </>
  );
}
