import { QuickFieldSelection, type Entity, type SeatPermissions, type Scene } from '@mythic/shared';
import type { KeyValueStore } from '../net/identity.js';
import { tokenQuickFields } from './registries.js';
import type { ViewerRole } from './viewer.js';

export const DEFAULT_QUICK_FIELDS: QuickFieldSelection = ['hp', 'ac', 'speed'];
const key = (viewerId: string) => `mythic.quick-fields.v1:${encodeURIComponent(viewerId)}`;

/** UI preference only: scoped to an identity on this browser, never put in campaign state. */
export function loadQuickFieldSelection(
  store: KeyValueStore,
  viewerId: string,
): QuickFieldSelection {
  try {
    const result = QuickFieldSelection.safeParse(
      JSON.parse(store.getItem(key(viewerId)) ?? 'null'),
    );
    if (result.success) return result.data;
  } catch {
    /* Storage can be unavailable or corrupt. */
  }
  return [...DEFAULT_QUICK_FIELDS];
}

export function saveQuickFieldSelection(
  store: KeyValueStore,
  viewerId: string,
  selection: unknown,
): boolean {
  const parsed = QuickFieldSelection.safeParse(selection);
  if (!parsed.success || parsed.data.some((id) => !tokenQuickFields.get(id))) return false;
  try {
    store.setItem(key(viewerId), JSON.stringify(parsed.data));
    return true;
  } catch {
    return false;
  }
}

export interface QuickFieldPreview {
  id: string;
  label: string;
  value: number | null;
  text: string;
  color: string | null;
}

/** Reads ONLY the host-filtered entity. Missing/private values never get synthetic statistics. */
export function quickFieldPreview(
  entity: Entity,
  selection: QuickFieldSelection,
  role: ViewerRole,
  permissions: SeatPermissions | null,
  grid: Scene['grid'],
): QuickFieldPreview[] {
  return selection.map((id) => {
    const entry = tokenQuickFields.get(id);
    const field = entry?.allowed(role, permissions)
      ? entity.token?.quickFields?.[entry.field]
      : undefined;
    return {
      id,
      label: entry?.label ?? id,
      value: field?.value ?? null,
      text: field
        ? entry?.field === 'speed'
          ? `${String(field.value * grid.unitsPerCell)} ${grid.unitLabel}`
          : String(field.value)
        : 'not shared',
      color: field?.color ?? null,
    };
  });
}
