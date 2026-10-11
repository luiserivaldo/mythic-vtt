import { beforeEach, describe, expect, it } from 'vitest';
import type { Scene } from '@mythic/shared';
import { aoeToolStore } from './aoe-tool-store.js';
import { activateMeasurement, measurementScene } from './measurement-tool.js';
import { rulerStore } from './ruler-store.js';
import { prepareRulerPoint } from './ruler.js';

const scene: Scene = {
  id: 'scene',
  name: 'table',
  entities: {},
  layers: {},
  environment: { background: '#ffffff' },
  grid: {
    type: 'square',
    sizePx: 48,
    unitsPerCell: 5,
    unitLabel: 'ft',
    diagonal: 'chebyshev',
    snap: true,
  },
};
beforeEach(() => {
  activateMeasurement(null);
  rulerStore
    .getState()
    .setPreferences({ mode: '2d', snap: true, broadcast: true, measureMovement: true });
});
describe('unified measurement tools', () => {
  it('switches between distance and every AoE with only one active pointer tool', () => {
    for (const kind of ['sphere', 'cylinder', 'cone', 'cube', 'line'] as const) {
      activateMeasurement('distance');
      expect(rulerStore.getState().tool).toBe(true);
      expect(aoeToolStore.getState().active).toBe(false);
      rulerStore.getState().begin(scene.id, { x: 1, y: 0, z: 1 });
      activateMeasurement(kind);
      expect(rulerStore.getState()).toMatchObject({ tool: false, phase: 'idle', points: [] });
      expect(aoeToolStore.getState()).toMatchObject({ active: true, draft: { kind } });
    }
    activateMeasurement(null);
    expect(aoeToolStore.getState().active).toBe(false);
  });
  it('turns off snapping locally without changing the scene grid or its units', () => {
    const raw = { x: 2.23, z: 4.67 };
    const snapped = prepareRulerPoint(raw, measurementScene(scene));
    rulerStore.getState().setPreferences({ snap: false });
    expect(prepareRulerPoint(raw, measurementScene(scene))).toEqual({ ...raw, y: 0 });
    expect(snapped).not.toEqual({ ...raw, y: 0 });
    expect(scene.grid.snap).toBe(true);
    expect(measurementScene(scene).grid.unitsPerCell).toBe(5);
  });
  it('changing measurement mode clears the old path and retains other preferences', () => {
    rulerStore.getState().setPreferences({ broadcast: false, measureMovement: false });
    rulerStore.getState().begin(scene.id, { x: 1, y: 0, z: 1 });
    rulerStore.getState().setPreferences({ mode: '3d' });
    expect(rulerStore.getState()).toMatchObject({
      mode: '3d',
      phase: 'idle',
      points: [],
      broadcast: false,
      measureMovement: false,
    });
  });
});
