import { beforeEach, describe, expect, it } from 'vitest';
import { aoeToolStore } from '../tools/aoe-tool-store.js';
import { rulerStore } from '../tools/ruler-store.js';
import { leftPaneStore, panelRegion, paneShift } from './left-pane.js';
import { createRegistry, toolPanels, type ToolPanel } from './registries.js';
import { TOOL_PANEL_ORDER } from './tool-panel-layout.js';

describe('UI-SHELL-05 left pane', () => {
  beforeEach(() => {
    leftPaneStore.setState({ collapsed: false });
  });

  it('registers every tool panel with a region', () => {
    expect(toolPanels.all().map((panel) => panel.id)).toEqual([...TOOL_PANEL_ORDER]);
    // UI-TOKEN-07 (MV-266): the selection's panels (Transform, AoE, Token) open in the left pane
    // with Draw, Initiative and Create Prop; Measure beside its rail button; none in the dock.
    const expected: Record<string, string> = {
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

describe('MV-267 Measure tucks the pane away', () => {
  beforeEach(() => {
    rulerStore.getState().setTool(false);
    aoeToolStore.getState().setActive(false);
    leftPaneStore.setState({ collapsed: false });
  });

  it('collapses for the ruler and reopens when it is put away', () => {
    rulerStore.getState().setTool(true);
    expect(leftPaneStore.getState().collapsed).toBe(true);
    rulerStore.getState().setTool(false);
    expect(leftPaneStore.getState().collapsed).toBe(false);
  });

  it('stays collapsed through a switch from the ruler to an AoE template', () => {
    rulerStore.getState().setTool(true);
    aoeToolStore.getState().setActive(true);
    rulerStore.getState().setTool(false);
    expect(leftPaneStore.getState().collapsed).toBe(true);
    aoeToolStore.getState().setActive(false);
    expect(leftPaneStore.getState().collapsed).toBe(false);
  });

  it('leaves a pane the user collapsed collapsed', () => {
    leftPaneStore.getState().toggleCollapsed();
    rulerStore.getState().setTool(true);
    rulerStore.getState().setTool(false);
    expect(leftPaneStore.getState().collapsed).toBe(true);
  });

  it('keeps the pane where the user puts it while measuring', () => {
    rulerStore.getState().setTool(true);
    leftPaneStore.getState().toggleCollapsed();
    expect(leftPaneStore.getState().collapsed).toBe(false);
    leftPaneStore.getState().toggleCollapsed();
    rulerStore.getState().setTool(false);
    expect(leftPaneStore.getState().collapsed).toBe(true);
  });

  it('holds a new selection until measuring ends', () => {
    leftPaneStore.getState().toggleCollapsed();
    aoeToolStore.getState().setActive(true);
    leftPaneStore.getState().revealSelection();
    expect(leftPaneStore.getState().collapsed).toBe(true);
    aoeToolStore.getState().setActive(false);
    expect(leftPaneStore.getState().collapsed).toBe(false);
    leftPaneStore.getState().toggleCollapsed();
    leftPaneStore.getState().revealSelection();
    expect(leftPaneStore.getState().collapsed).toBe(false);
  });
});

describe('MV-279 pane shift', () => {
  // A 288 x 560 pane right of a 154 px rail, over a 900 px wide board.
  const pane = { left: 162, top: 8, width: 288, height: 560 };
  const at = (x: number, y: number) => ({ left: x - 10, right: x + 10, y });

  it('stays beside the rail with nothing selected or the selection clear of it', () => {
    expect(paneShift(null, pane, 900)).toBe(0);
    expect(paneShift(at(700, 100), pane, 900)).toBe(0);
    expect(paneShift(at(300, 680), pane, 900)).toBe(0);
  });

  it('moves just past the selection and its handles when it would cover them', () => {
    expect(paneShift(at(300, 100), pane, 900)).toBe(300 + 10 + 64 - 162);
    // Under the rail, but its handles reach under the pane.
    expect(paneShift(at(120, 100), pane, 900)).toBe(120 + 10 + 64 - 162);
  });

  it('stays when moving would push it off the board', () => {
    expect(paneShift(at(300, 100), pane, 600)).toBe(0);
  });
});
