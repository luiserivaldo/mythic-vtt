import { beforeEach, describe, expect, it } from 'vitest';
import { isCollapsible, TOOL_PANEL_ORDER, toolPanelLayoutStore } from './tool-panel-layout.js';

describe('tool panel layout', () => {
  beforeEach(() => {
    toolPanelLayoutStore.setState({
      collapsed: {
        aoe: false,
        token: true,
        ruler: false,
        draw: false,
        'create-prop': false,
        initiative: false,
        camera: true,
      },
    });
  });

  it('keeps a stable stacking order', () => {
    expect(TOOL_PANEL_ORDER).toEqual([
      'transform',
      'aoe',
      'token',
      'ruler',
      'draw',
      'create-prop',
      'initiative',
      'camera',
    ]);
  });

  it('collapses active panels without hiding their restore control', () => {
    toolPanelLayoutStore.getState().collapse('aoe');
    toolPanelLayoutStore.getState().collapse('ruler');
    expect(toolPanelLayoutStore.getState().collapsed).toEqual({
      aoe: true,
      token: true,
      ruler: true,
      draw: false,
      'create-prop': false,
      initiative: false,
      camera: true,
    });

    toolPanelLayoutStore.getState().restore('aoe');
    toolPanelLayoutStore.getState().restore('ruler');
    expect(toolPanelLayoutStore.getState().collapsed).toEqual({
      aoe: false,
      token: true,
      ruler: false,
      draw: false,
      'create-prop': false,
      initiative: false,
      camera: true,
    });
  });

  it('gives Transform no collapse state: it follows the selection (UI-TOKEN-07, MV-266)', () => {
    expect(isCollapsible('transform')).toBe(false);
    expect('transform' in toolPanelLayoutStore.getInitialState().collapsed).toBe(false);
    for (const id of TOOL_PANEL_ORDER) if (id !== 'transform') expect(isCollapsible(id)).toBe(true);
    expect(toolPanelLayoutStore.getInitialState().collapsed.token).toBe(true);
    // UI-CAM-01: the Pan tool's camera panel starts as its expandable bar.
    expect(toolPanelLayoutStore.getInitialState().collapsed.camera).toBe(true);
  });
});
