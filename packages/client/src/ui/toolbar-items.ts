import type { ViewerRole } from './viewer.js';

export type PanelId = 'scenes' | 'layers' | 'seats';

export interface ToolbarItem {
  id: PanelId;
  label: string;
}

/** Which panel toggles this viewer gets (pure, so it is unit-tested). */
export function toolbarItems(role: ViewerRole): ToolbarItem[] {
  const items: ToolbarItem[] = [];
  if (role === 'host' || role === 'codm') {
    items.push({ id: 'scenes', label: 'Scenes' }, { id: 'layers', label: 'Layers' });
  }
  if (role === 'host') items.push({ id: 'seats', label: 'Seats' });
  return items;
}
