import type { Campaign } from '@mythic/shared';
import { describe, expect, it } from 'vitest';
import { activeRenderGrid } from './grid-model.js';

const SCENE = 'S'.repeat(26);
function campaign(grid: Record<string, unknown>, activeSceneId: string | null = SCENE): Campaign {
  return {
    activeSceneId,
    scenes: {
      [SCENE]: {
        grid: { type: 'square', sizePx: 70, unitsPerCell: 5, unitLabel: 'ft', ...grid },
      },
    },
  } as unknown as Campaign;
}

describe('activeRenderGrid', () => {
  it('applies defaults for a grid without colour or opacity', () => {
    expect(activeRenderGrid(campaign({}))).toEqual({
      color: '#ffffff',
      opacity: 0.25,
      bounds: { width: 40, height: 30 },
    });
  });
  it('uses the scene values', () => {
    expect(activeRenderGrid(campaign({ color: '#112233', opacity: 0.8 }))).toEqual({
      color: '#112233',
      opacity: 0.8,
      bounds: { width: 40, height: 30 },
    });
  });
  it('carries the scene bounds', () => {
    const c = campaign({});
    const scene = c.scenes[SCENE];
    if (scene) scene.bounds = { width: 12, height: 9 };
    expect(activeRenderGrid(c)?.bounds).toEqual({ width: 12, height: 9 });
  });
  it('is null without an active scene or for hex grids', () => {
    expect(activeRenderGrid(null)).toBeNull();
    expect(activeRenderGrid(campaign({}, null))).toBeNull();
    expect(activeRenderGrid(campaign({ type: 'hex' }))).toBeNull();
  });
});
