import { ScreenQuad } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { Color, Vector4 } from 'three';
import type { SceneOverlay as Overlay } from '@mythic/shared';

const vertexShader = 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }';
const fragmentShader = 'uniform vec4 wash; void main() { gl_FragColor = wash; }';

/** ENV-08: one screen-space pass affects only WebGL, leaving HTML labels and input untouched. */
export function SceneOverlay({ overlay }: { overlay: Overlay | undefined }) {
  const invalidate = useThree((state) => state.invalidate);
  const uniforms = useMemo(() => {
    const tint = new Color(overlay?.tint ?? '#ffffff');
    const strength = overlay?.tintOpacity ?? 0;
    const dark = overlay?.darkness ?? 0;
    const alpha = 1 - (1 - strength) * (1 - dark);
    const weight = alpha ? (strength * (1 - dark)) / alpha : 0;
    return {
      wash: { value: new Vector4(tint.r * weight, tint.g * weight, tint.b * weight, alpha) },
    };
  }, [overlay]);
  useEffect(() => {
    invalidate();
  }, [uniforms, invalidate]);
  if (!overlay || (!overlay.tintOpacity && !overlay.darkness)) return null;
  return (
    <ScreenQuad name="scene-overlay" renderOrder={10000} raycast={() => {}}>
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        transparent
        depthTest={false}
        depthWrite={false}
        toneMapped={false}
      />
    </ScreenQuad>
  );
}
