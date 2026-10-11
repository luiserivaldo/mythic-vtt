import type { Scene } from '@mythic/shared';
import { aoeToolStore } from './aoe-tool-store.js';
import type { AoEKind } from './aoe-placement.js';
import { rulerStore } from './ruler-store.js';

export const MEASUREMENT_SHAPES: readonly { kind: AoEKind; flat: string; volume: string }[] = [
  { kind: 'sphere', flat: 'Circle', volume: 'Sphere' },
  { kind: 'cylinder', flat: 'Circle with height', volume: 'Cylinder' },
  { kind: 'cone', flat: 'Cone', volume: 'Cone' },
  { kind: 'cube', flat: 'Square', volume: 'Cube' },
  { kind: 'line', flat: 'Line', volume: 'Line' },
];

/** M3-15: one pointer owner, whether measuring a distance or placing an AoE. */
export function activateMeasurement(shape: 'distance' | AoEKind | null): void {
  rulerStore.getState().setTool(shape === 'distance');
  aoeToolStore.getState().setActive(shape !== null && shape !== 'distance');
  if (shape !== null && shape !== 'distance') aoeToolStore.getState().setDraft({ kind: shape });
}

/** Snapping is a local measurement preference, never a grid.update action. */
export function measurementScene(scene: Scene): Scene {
  return { ...scene, grid: { ...scene.grid, snap: rulerStore.getState().snap && scene.grid.snap } };
}
