/// <reference types="vite/client" />

import type { Orbit3D } from './render/camera-3d.js';

declare global {
  interface Window {
    /** Read-only camera diagnostics exposed by development builds for Playwright. */
    __mythicCamera?: {
      getPose(): Readonly<Orbit3D>;
    };
    /** Development-only read access to actual primitive material state. */
    __mythicOcclusion?: {
      getMaterials(): { id: string; opacity: number; depthWrite: boolean }[];
    };
    /** Development/test-only render counters for performance assertions. */
    __mythicRender?: {
      getFrameCount(): number;
      getRenderInfo(): { calls: number; triangles: number; lines: number; points: number };
    };
  }
}
