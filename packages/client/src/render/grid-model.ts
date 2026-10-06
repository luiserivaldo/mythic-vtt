import {
  resolveGridStyle,
  resolveSceneBounds,
  type Campaign,
  type SceneBounds,
} from '@mythic/shared';

export interface RenderGrid {
  color: string;
  opacity: number;
  /** D37: the canvas the grid is clipped to. */
  bounds: SceneBounds;
}

/**
 * Grid style of the active scene, with GRID-01 defaults applied. Null when there is no
 * active scene or the grid type is not drawable yet (hex is GRID-04, P2).
 */
export function activeRenderGrid(campaign: Campaign | null): RenderGrid | null {
  if (!campaign?.activeSceneId) return null;
  const scene = campaign.scenes[campaign.activeSceneId];
  if (!scene || scene.grid.type !== 'square') return null;
  return { ...resolveGridStyle(scene.grid), bounds: resolveSceneBounds(scene) };
}
