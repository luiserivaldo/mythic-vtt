import { resolveGridStyle, type Campaign } from '@mythic/shared';

export interface RenderGrid {
  color: string;
  opacity: number;
}

/**
 * Grid style of the active scene, with GRID-01 defaults applied. Null when there is no
 * active scene or the grid type is not drawable yet (hex is GRID-04, P2).
 */
export function activeRenderGrid(campaign: Campaign | null): RenderGrid | null {
  if (!campaign?.activeSceneId) return null;
  const grid = campaign.scenes[campaign.activeSceneId]?.grid;
  if (!grid || grid.type !== 'square') return null;
  return resolveGridStyle(grid);
}
