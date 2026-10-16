import type { ViewerRole } from './viewer.js';
import type { SeatPermissions } from '@mythic/shared';
import type { ViewMode } from '../render/view-mode-store.js';
import { visibleDockTabs } from './dock-tabs.js';

export type PanelId = string;

export interface ToolbarItem {
  id: PanelId;
  label: string;
}

/** Which panel toggles this viewer gets in `view` (pure, so it is unit-tested). */
export function toolbarItems(
  role: ViewerRole,
  permissions: SeatPermissions | null = null,
  view: ViewMode = '2d',
): ToolbarItem[] {
  return visibleDockTabs(role, permissions, view).map(({ id, label }) => ({ id, label }));
}
