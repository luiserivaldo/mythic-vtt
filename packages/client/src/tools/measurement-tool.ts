import type { Scene } from '@mythic/shared';
import { aoeToolStore } from './aoe-tool-store.js';
import type { AoEKind } from './aoe-placement.js';
import { rulerStore } from './ruler-store.js';

export type MeasureShape = 'distance' | AoEKind;

/**
 * UI-MEAS-02: the Measure panel's shape group. The list follows the 2D / 3D choice; a ruler
 * always comes first. The kinds are the same shapes either way, only the names differ.
 */
export function measureShapeChoices(
  mode: '2d' | '3d',
): readonly { shape: MeasureShape; label: string }[] {
  return mode === '2d'
    ? [
        { shape: 'distance', label: 'Ruler' },
        { shape: 'cone', label: 'Cone' },
        { shape: 'cube', label: 'Square' },
        { shape: 'sphere', label: 'Circle' },
      ]
    : [
        { shape: 'distance', label: '3D ruler' },
        { shape: 'sphere', label: 'Sphere' },
        { shape: 'cylinder', label: 'Cylinder' },
        { shape: 'cone', label: 'Cone' },
        { shape: 'cube', label: 'Cube' },
      ];
}

/** The shape to keep after switching 2D / 3D: the same one if the new group has it, else the ruler. */
export function shapeAfterModeChange(shape: MeasureShape, mode: '2d' | '3d'): MeasureShape {
  return measureShapeChoices(mode).some((choice) => choice.shape === shape) ? shape : 'distance';
}

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
