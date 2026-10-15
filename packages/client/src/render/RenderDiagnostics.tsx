import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { selectionStore } from '../tools/selection-store.js';

const DIAGNOSTICS_ENABLED = import.meta.env.DEV || import.meta.env.MODE === 'test';

/** Development-only renderer counters used by the performance e2e. */
export function RenderDiagnostics() {
  const scene = useThree((state) => state.scene);
  const gl = useThree((state) => state.gl);
  const frames = useRef(0);

  useFrame(() => {
    frames.current += 1;
  });

  useEffect(() => {
    if (!DIAGNOSTICS_ENABLED) return;
    const diagnostics = {
      getObjectNames: () => {
        const names: string[] = [];
        scene.traverse((object) => {
          if (object.name) names.push(object.name);
        });
        return names;
      },
      getFrameCount: () => frames.current,
      getRenderInfo: () => ({
        calls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        lines: gl.info.render.lines,
        points: gl.info.render.points,
      }),
      /** Depth-test flag and render order of every mesh with this name (layering e2e). */
      getMeshLayering: (name: string) => {
        const found: { depthTest: boolean; renderOrder: number }[] = [];
        scene.traverse((object) => {
          const material = (object as { material?: { depthTest?: boolean } }).material;
          if (object.name === name && material?.depthTest !== undefined)
            found.push({ depthTest: material.depthTest, renderOrder: object.renderOrder });
        });
        return found;
      },
      /** Material colour of every mesh with this name, as `#rrggbb` (inactive-layer shade e2e). */
      getMeshColors: (name: string) => {
        const colors: string[] = [];
        scene.traverse((object) => {
          const material = (object as { material?: { color?: { getHexString(): string } } })
            .material;
          if (object.name === name && material?.color)
            colors.push(`#${material.color.getHexString()}`);
        });
        return colors;
      },
      /** The local selection (UX-16 marquee e2e). */
      getSelection: () => [...selectionStore.getState().ids],
      getObjectCount: (name: string) => {
        let count = 0;
        scene.traverse((object) => {
          if (object.name === name) count += 1;
        });
        return count;
      },
    };
    window.__mythicRender = diagnostics;
    return () => {
      if (window.__mythicRender === diagnostics) delete window.__mythicRender;
    };
  }, [gl, scene]);

  return null;
}
