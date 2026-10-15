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
    /** Development-only 2D camera state for the CAM-06 focus e2e. */
    __mythicFocus?: {
      getView2d(): {
        centerX: number;
        centerZ: number;
        zoom: number;
        animating: boolean;
        poses: number;
      };
    };
    /** Development-only camera-link counters for the CAM-06 pull/follow e2e. */
    __mythicCameraLink?: {
      getLink(): { sent: number; pulls: number; following: boolean };
    };
    /** Development-only panel routing for the UI-SHELL-05 left pane e2e. */
    __mythicPanelRegions?: {
      set(id: string, region: 'left-pane' | 'beside-rail' | 'beside-token'): void;
    };
    /** Development/test-only render counters for performance assertions. */
    __mythicRender?: {
      getFrameCount(): number;
      getObjectNames(): string[];
      getRenderInfo(): { calls: number; triangles: number; lines: number; points: number };
      getObjectCount(name: string): number;
      getMeshLayering(name: string): { depthTest: boolean; renderOrder: number }[];
    };
  }
}
