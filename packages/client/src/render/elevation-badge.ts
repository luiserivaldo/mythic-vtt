import { heightAboveGround, type Grid, type WalkableSurface } from '@mythic/shared';
import { formatElevation } from '../tools/elevation.js';

/**
 * UI-TOKEN-05 / MV-243: the badge reads relative to the highest walkable ground under the token,
 * not the plane, so a token on a platform reads 0 and a flyer reads its height above what is below.
 */
export function badgeElevation(
  position: readonly [number, number, number],
  walkables: readonly WalkableSurface[],
): number {
  const [x, y, z] = position;
  return heightAboveGround({ x, y, z }, walkables);
}

/**
 * UI-TOKEN-05: the elevation badge text, or null when there is no badge to draw. The "Show
 * height labels" viewer setting is per viewer and removes the whole badge text, so the setting is
 * checked first. The 3D drop line and ground shadow are drawn by `DropLines` and are unaffected.
 */
export function elevationBadgeText(
  cells: number,
  grid: Pick<Grid, 'unitsPerCell' | 'unitLabel'>,
  flying: boolean,
  showHeightLabels: boolean,
): string | null {
  if (!showHeightLabels) return null;
  const elevation = formatElevation(cells, grid);
  // A flying token is marked even at ground level, where there is no elevation text to show.
  if (elevation === null && !flying) return null;
  return [flying ? '✈ Flying' : null, elevation].filter(Boolean).join(' ');
}
