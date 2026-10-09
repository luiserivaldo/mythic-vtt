import type { ViewerRole } from './viewer.js';
import type { SeatPermissions } from '@mythic/shared';
import { dockTabs } from './registries.js';

export type PanelId = string;

export interface ToolbarItem {
  id: PanelId;
  label: string;
}

/** Which panel toggles this viewer gets (pure, so it is unit-tested). */
export function toolbarItems(
  role: ViewerRole,
  permissions: SeatPermissions | null = null,
): ToolbarItem[] {
  return dockTabs.allowed(role, permissions).map(({ id, label }) => ({ id, label }));
}
