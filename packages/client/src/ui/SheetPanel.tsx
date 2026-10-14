import { SHEET_WIP_NOTE, SHEET_WIP_TEXT } from './sheet-panel.js';

/** UI-SHEET-01: the Sheet tab's placeholder. Sheets arrive later (CHAR-01); no data is shown. */
export function SheetPanel() {
  return (
    <section className="ui-panel ui-dock-placeholder" aria-label="Sheet">
      <h2>Sheet</h2>
      <p>
        {SHEET_WIP_TEXT}: {SHEET_WIP_NOTE}
      </p>
    </section>
  );
}
