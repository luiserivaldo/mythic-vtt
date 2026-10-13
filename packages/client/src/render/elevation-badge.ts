import type { Grid } from '@mythic/shared';
import { formatElevation } from '../tools/elevation.js';

/**
 * UI-TOKEN-05: the 2D elevation badge text, or null when there is no badge to draw. The "Show
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
