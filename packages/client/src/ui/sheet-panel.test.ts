import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { dockStore } from './dock-store.js';
import { resolveActiveTab, visibleDockTabs } from './dock-tabs.js';
import { SheetPanel } from './SheetPanel.js';
import { seeSheet, SHEET_TAB_ID, SHEET_WIP_NOTE, SHEET_WIP_TEXT } from './sheet-panel.js';

// UI-SHEET-01: the alpha Sheet tab is a placeholder labelled `WIP`, holding no sheet data.
describe('UI-SHEET-01 Sheet tab placeholder', () => {
  it('renders the WIP label and nothing but text', () => {
    const html = renderToStaticMarkup(createElement(SheetPanel));
    expect(html).toContain('aria-label="Sheet"');
    expect(html).toContain(SHEET_WIP_TEXT);
    expect(html).toContain(SHEET_WIP_NOTE);
    // There is no sheet data: no field, list, image or control in the placeholder.
    expect(html).not.toMatch(/<(input|select|table|ul|ol|li|img|button|canvas)\b/);
  });

  it('See Sheet selects the Sheet tab and expands a collapsed dock', () => {
    dockStore.setState({ requested: 'chat', collapsed: true });
    seeSheet();
    expect(dockStore.getState().requested).toBe(SHEET_TAB_ID);
    expect(dockStore.getState().collapsed).toBe(false);
  });

  it('selects the Sheet tab for every role the registry offers it to', () => {
    for (const role of ['host', 'codm', 'player', 'observer'] as const) {
      expect(visibleDockTabs(role).map((tab) => tab.id)).toContain(SHEET_TAB_ID);
      expect(resolveActiveTab(role, null, SHEET_TAB_ID)).toBe(SHEET_TAB_ID);
    }
  });
});
