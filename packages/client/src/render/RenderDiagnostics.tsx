import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';

const DIAGNOSTICS_ENABLED = import.meta.env.DEV || import.meta.env.MODE === 'test';

/** Development-only renderer counters used by the performance e2e. */
export function RenderDiagnostics() {
  const gl = useThree((state) => state.gl);
  const frames = useRef(0);

  useFrame(() => {
    frames.current += 1;
  });

  useEffect(() => {
    if (!DIAGNOSTICS_ENABLED) return;
    const diagnostics = {
      getFrameCount: () => frames.current,
      getRenderInfo: () => ({
        calls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        lines: gl.info.render.lines,
        points: gl.info.render.points,
      }),
    };
    window.__mythicRender = diagnostics;
    return () => {
      if (window.__mythicRender === diagnostics) delete window.__mythicRender;
    };
  }, [gl]);

  return null;
}
