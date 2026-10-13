import { beforeEach, describe, expect, it } from 'vitest';
import { TOOL_PANEL_ORDER, toolPanelLayoutStore } from './tool-panel-layout.js';

describe('tool panel layout', () => {
  beforeEach(() => {
    toolPanelLayoutStore.setState({
      collapsed: {
        transform: false,
        aoe: false,
        token: true,
        ruler: false,
        'create-prop': false,
        initiative: false,
      },
    });
  });

  it('keeps a stable stacking order', () => {
    expect(TOOL_PANEL_ORDER).toEqual([
      'transform',
      'aoe',
      'token',
      'ruler',
      'create-prop',
      'initiative',
    ]);
  });

  it('collapses active panels without hiding their restore control', () => {
    toolPanelLayoutStore.getState().collapse('transform');
    toolPanelLayoutStore.getState().collapse('aoe');
    expect(toolPanelLayoutStore.getState().collapsed).toEqual({
      transform: true,
      aoe: true,
      token: true,
      ruler: false,
      'create-prop': false,
      initiative: false,
    });

    toolPanelLayoutStore.getState().restore('transform');
    toolPanelLayoutStore.getState().restore('aoe');
    expect(toolPanelLayoutStore.getState().collapsed).toEqual({
      transform: false,
      aoe: false,
      token: true,
      ruler: false,
      'create-prop': false,
      initiative: false,
    });
  });
});
