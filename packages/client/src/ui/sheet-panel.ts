import { dockStore } from './dock-store.js';

/**
 * UI-SHEET-01 / CHAR-01: character sheets land in a later milestone, so the alpha ships the tab as a
 * placeholder. Nothing here stores or fetches sheet data.
 */

/** The registry id of the Sheet tab, and the dock id "See Sheet" jumps to. */
export const SHEET_TAB_ID = 'sheet';

/** The placeholder's label, as the dock shows it. */
export const SHEET_WIP_TEXT = 'WIP';

/** The one honest line under the label; there is no sheet data behind it yet. */
export const SHEET_WIP_NOTE = 'Character sheets are coming soon.';

/** UI-SHEET-01: "See Sheet" on a token selects the Sheet tab (and expands a collapsed dock). */
export function seeSheet(): void {
  dockStore.getState().open(SHEET_TAB_ID);
}
