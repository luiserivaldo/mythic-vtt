import { beforeEach, describe, expect, it } from 'vitest';
import { leftPaneStore, panelRegion } from './left-pane.js';
import { createRegistry, toolPanels, type ToolPanel } from './registries.js';
import { TOOL_PANEL_ORDER } from './tool-panel-layout.js';

describe('UI-SHELL-05 left pane', () => {
  beforeEach(() => {
    leftPaneStore.setState({ collapsed: false });
  });

  it('registers every tool panel with a region', () => {
    expect(toolPanels.all().map((panel) => panel.id)).toEqual([...TOOL_PANEL_ORDER]);
    // MV-239: selection panels open beside the token, Measure beside its rail button, Draw,
    // Initiative and Create Prop in the left pane; none in the dock.
    const expected: Record<string, string> = {
      transform: 'beside-token',
      aoe: 'beside-token',
      token: 'beside-token',
      ruler: 'beside-rail',
    };
    for (const id of TOOL_PANEL_ORDER) expect(panelRegion(id)).toBe(expected[id] ?? 'left-pane');
  });

  it('routes a panel to the region its entry names', () => {
    const panels = createRegistry<ToolPanel>(toolPanels.all());
    panels.register({
      id: 'object-edit',
      label: 'Object Edit',
      icon: 'cube',
      group: 'rail',
      allowed: () => true,
      region: 'left-pane',
    });
    expect(panels.get('object-edit')?.region).toBe('left-pane');
    expect(panelRegion('not-registered')).toBe('left-pane');
  });

  it('collapses, and expands when a tool reveals it', () => {
    leftPaneStore.getState().toggleCollapsed();
    expect(leftPaneStore.getState().collapsed).toBe(true);
    leftPaneStore.getState().expand();
    expect(leftPaneStore.getState().collapsed).toBe(false);
  });
});
