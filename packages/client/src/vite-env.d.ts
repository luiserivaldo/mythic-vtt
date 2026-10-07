/// <reference types="vite/client" />

import type { Orbit3D } from './render/camera-3d.js';

declare global {
  interface Window {
    /** Read-only camera diagnostics exposed by development builds for Playwright. */
    __mythicCamera?: {
      getPose(): Readonly<Orbit3D>;
    };
  }
}
