import { beforeEach, describe, expect, it } from 'vitest';
import { selectionStore } from '../tools/selection-store.js';
import { TOOL_PANEL_ORDER, toolPanelLayoutStore } from './tool-panel-layout.js';

describe('tool panel layout', () => {
  beforeEach(() => {
    toolPanelLayoutStore.setState({
      collapsed: {
        transform: false,
        aoe: false,
        token: true,
        ruler: false,
        draw: false,
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
      'draw',
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
      draw: false,
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
      draw: false,
      'create-prop': false,
      initiative: false,
    });
  });

  it('starts Transform and Token as their chips (MV-239)', () => {
    const initial = toolPanelLayoutStore.getInitialState().collapsed;
    expect(initial.transform).toBe(true);
    expect(initial.token).toBe(true);
  });

  it('tucks Transform again when the selection changes, and only then', () => {
    selectionStore.getState().pick('scene-1', 'a', false);
    toolPanelLayoutStore.getState().restore('transform');
    toolPanelLayoutStore.getState().restore('token');
    selectionStore.getState().pick('scene-1', 'a', false);
    expect(toolPanelLayoutStore.getState().collapsed.transform).toBe(false);
    selectionStore.getState().pick('scene-1', 'b', false);
    expect(toolPanelLayoutStore.getState().collapsed.transform).toBe(true);
    expect(toolPanelLayoutStore.getState().collapsed.token).toBe(false);
    selectionStore.getState().clear();
  });
});
