import { describe, expect, it } from 'vitest';
import { DEFAULT_DOCK_TAB, DOCK_ICONS, resolveActiveTab, visibleDockTabs } from './dock-tabs.js';
import { dockTabs } from './registries.js';

const ids = (role: Parameters<typeof visibleDockTabs>[0]) =>
  visibleDockTabs(role).map((tab) => tab.id);

describe('UI-DOCK-01 role-based tabs', () => {
  it('shows players and spectators only Chat, Sheet, Help and Settings', () => {
    for (const role of ['player', 'observer'] as const)
      expect(ids(role)).toEqual(['chat', 'sheet', 'help', 'settings']);
  });

  it('adds the DM tabs for the host and co-DM', () => {
    for (const role of ['host', 'codm'] as const) {
      for (const id of ['chat', 'sheet', 'help', 'settings', 'entities', 'layers', 'scenes'])
        expect(ids(role)).toContain(id);
    }
    expect(ids('host')).toContain('seats');
    // Seat management is host-only in the shared actions, so a co-DM is not offered it.
    expect(ids('codm')).not.toContain('seats');
    expect(ids('host').at(0)).toBe(DEFAULT_DOCK_TAB);
  });

  it('never resolves a viewer to a tab the registry predicate denies', () => {
    for (const role of ['player', 'observer'] as const)
      for (const tab of dockTabs.all().filter((t) => !ids(role).includes(t.id)))
        expect(resolveActiveTab(role, null, tab.id)).toBe(DEFAULT_DOCK_TAB);
    expect(resolveActiveTab('host', null, 'entities')).toBe('entities');
    expect(resolveActiveTab('host', null, 'no-such-tab')).toBe(DEFAULT_DOCK_TAB);
  });

  it('has an icon for every registered tab', () => {
    for (const tab of dockTabs.all()) expect(DOCK_ICONS[tab.icon]).toBeTruthy();
  });
});
