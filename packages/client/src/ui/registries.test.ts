import { describe, expect, it } from 'vitest';
import {
  createRegistry,
  dockTabs,
  railTools,
  tokenQuickFields,
  type DockTab,
  type RailTool,
} from './registries.js';

const permissions = { view: true, move: true, edit: false, delete: false };

describe('UI-SHELL-03 registries', () => {
  it('registers a new tool and tab with their panels', () => {
    const tools = createRegistry<RailTool>(railTools.all());
    const tabs = createRegistry<DockTab>(dockTabs.all());
    tools.register({
      id: 'dummy-tool',
      label: 'Dummy tool',
      icon: 'test-tool',
      group: 'test',
      allowed: (_role, perms) => perms?.edit === true,
      panel: 'dummy-tool-panel',
    });
    tabs.register({
      id: 'dummy-tab',
      label: 'Dummy tab',
      icon: 'test-tab',
      group: 'test',
      allowed: (role) => role === 'host',
      panel: 'dummy-tab-panel',
    });

    expect(tools.get('dummy-tool')?.panel).toBe('dummy-tool-panel');
    expect(tools.allowed('player', permissions).some((entry) => entry.id === 'dummy-tool')).toBe(
      false,
    );
    expect(
      tools
        .allowed('player', { ...permissions, edit: true })
        .some((entry) => entry.id === 'dummy-tool'),
    ).toBe(true);
    expect(tabs.get('dummy-tab')?.panel).toBe('dummy-tab-panel');
    expect(tabs.allowed('host', null).some((entry) => entry.id === 'dummy-tab')).toBe(true);
    expect(tabs.allowed('player', permissions).some((entry) => entry.id === 'dummy-tab')).toBe(
      false,
    );
  });

  it('maps existing panel ids to dock tabs and declares the default quick fields', () => {
    expect(dockTabs.all().map(({ id, panel }) => [id, panel])).toEqual([
      ['scenes', 'scenes'],
      ['layers', 'layers'],
      ['map', 'map'],
      ['entities', 'entities'],
      ['seats', 'seats'],
      ['share', 'share'],
    ]);
    expect(tokenQuickFields.all().map(({ id }) => id)).toEqual(['hp', 'ac', 'speed']);
    expect(tokenQuickFields.allowed('player', { ...permissions, view: false })).toEqual([]);
    const firstTab = dockTabs.get('scenes');
    if (!firstTab) throw new Error('Scenes tab missing');
    expect(() => {
      dockTabs.register(firstTab);
    }).toThrow('Duplicate registry id');
  });
});
