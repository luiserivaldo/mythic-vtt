import { expect, type Page } from '@playwright/test';
import { stableBoardLayout } from './harness.js';

export interface ScreenPoint {
  x: number;
  y: number;
}

/** Cell to pixel, plus the board's pixels per cell. */
export type CellMap = ((x: number, z: number) => ScreenPoint) & { zoom: number };

/**
 * Maps scene cells to screen pixels on the 2D board as it stands once its size has settled.
 *
 * UI-TOKEN-07 (MV-266): selecting opens the left pane, which sits in flow and narrows the board;
 * deselecting closes it again. Until the user pans or zooms, the 2D view reframes the whole
 * default 40 x 30 canvas (1 cell padding) to the new size (D37), so the mapping must be taken
 * after the board stops changing size, not before the selection.
 */
export async function settledCellToPixel(page: Page): Promise<CellMap> {
  let box = await stableBoardLayout(page);
  await expect(async () => {
    box = await stableBoardLayout(page);
    // The camera has reframed to this box: the DOM box alone settles a frame before it does.
    const view = await page.evaluate<number | null>(
      '(() => { const v = window.__mythicFocus?.getView2d(); return v ? v.zoom : null; })()',
    );
    expect(view).not.toBeNull();
    expect(view ?? 0).toBeCloseTo(Math.min(box.width / 42, box.height / 32), 3);
  }).toPass();
  const zoom = Math.min(box.width / 42, box.height / 32);
  const at = (x: number, z: number) => ({
    x: box.x + box.width / 2 + (x - 20) * zoom,
    y: box.y + box.height / 2 + (z - 15) * zoom,
  });
  return Object.assign(at, { zoom });
}
