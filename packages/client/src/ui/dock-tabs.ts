import type { SeatPermissions } from '@mythic/shared';
import type { ViewMode } from '../render/view-mode-store.js';
import { dockTabs, type DockTab } from './registries.js';
import type { ViewerRole } from './viewer.js';

/** UI-DOCK-01: the dock opens on Chat. */
export const DEFAULT_DOCK_TAB = 'chat';

/** Glyphs for the registry icon names; the accessible name always comes from the tab label. */
export const DOCK_ICONS: Readonly<Record<string, string>> = {
  chat: '💬',
  sheet: '📜',
  scenes: '🗺',
  layers: '📚',
  entities: '♟',
  hierarchy: '🗂',
  prefabs: '🧰',
  seats: '👥',
  share: '🔗',
  help: '❓',
  settings: '⚙',
};

/** `view` is the local 2D/3D mode; a tab bound to a view mode is offered only there (C16). */
export function visibleDockTabs(
  role: ViewerRole,
  permissions: SeatPermissions | null = null,
  view: ViewMode = '2d',
): DockTab[] {
  return dockTabs
    .allowed(role, permissions)
    .filter((tab) => tab.view === undefined || tab.view === view);
}

/**
 * The tab whose content may render. A requested tab the viewer may not use (never offered, or lost
 * after a role change) falls back to Chat, so DM-only content is never mounted for anyone else.
 */
export function resolveActiveTab(
  role: ViewerRole,
  permissions: SeatPermissions | null,
  requested: string,
  view: ViewMode = '2d',
): string {
  return visibleDockTabs(role, permissions, view).some((tab) => tab.id === requested)
    ? requested
    : DEFAULT_DOCK_TAB;
}
