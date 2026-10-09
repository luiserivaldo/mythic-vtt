import { beforeEach, describe, expect, it } from 'vitest';
import { TOOL_PANEL_ORDER, toolPanelLayoutStore } from './tool-panel-layout.js';

describe('tool panel layout', () => {
  beforeEach(() => {
    toolPanelLayoutStore.setState({
      entities: 'hidden',
      collapsed: { transform: false, aoe: false, token: true },
    });
  });

  it('keeps a stable stacking order', () => {
    expect(TOOL_PANEL_ORDER).toEqual(['entities', 'transform', 'aoe', 'token']);
  });

  it('collapses active panels without hiding their restore control', () => {
    toolPanelLayoutStore.getState().toggleEntities();
    toolPanelLayoutStore.getState().collapse('entities');
    toolPanelLayoutStore.getState().collapse('aoe');

    expect(toolPanelLayoutStore.getState()).toMatchObject({
      entities: 'collapsed',
      collapsed: { transform: false, aoe: true },
    });

    toolPanelLayoutStore.getState().restore('entities');
    toolPanelLayoutStore.getState().restore('aoe');
    expect(toolPanelLayoutStore.getState()).toMatchObject({
      entities: 'open',
      collapsed: { transform: false, aoe: false, token: true },
    });
  });
});
