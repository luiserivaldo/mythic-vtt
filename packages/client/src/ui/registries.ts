import type { SeatPermissions } from '@mythic/shared';
import type { ViewerRole } from './viewer.js';

export type Allowed = (role: ViewerRole, permissions: SeatPermissions | null) => boolean;

export interface RegistryEntry {
  id: string;
  label: string;
  icon: string;
  group: string;
  allowed: Allowed;
}

export interface RailTool extends RegistryEntry {
  panel: string | null;
}

export interface DockTab extends RegistryEntry {
  panel: string;
}

export interface TokenQuickField extends RegistryEntry {
  field: string;
}

/** A local registry keeps test and feature additions isolated from the defaults. */
export function createRegistry<T extends RegistryEntry>(entries: readonly T[] = []) {
  const items = new Map<string, T>();
  for (const entry of entries) {
    if (items.has(entry.id)) throw new Error(`Duplicate registry id: ${entry.id}`);
    items.set(entry.id, entry);
  }
  return {
    register(entry: T): void {
      if (items.has(entry.id)) throw new Error(`Duplicate registry id: ${entry.id}`);
      items.set(entry.id, entry);
    },
    get(id: string): T | undefined {
      return items.get(id);
    },
    all(): T[] {
      return [...items.values()];
    },
    allowed(role: ViewerRole, permissions: SeatPermissions | null): T[] {
      return [...items.values()].filter((entry) => entry.allowed(role, permissions));
    },
  };
}

const admin: Allowed = (role) => role === 'host' || role === 'codm';
const host: Allowed = (role) => role === 'host';
const everyone: Allowed = () => true;
const canMove: Allowed = (role, permissions) =>
  admin(role, permissions) || permissions?.move === true;
const canEdit: Allowed = (role, permissions) =>
  admin(role, permissions) || permissions?.edit === true;
const canView: Allowed = (role, permissions) =>
  admin(role, permissions) || permissions?.view === true;

export const railTools = createRegistry<RailTool>([
  {
    id: 'select',
    label: 'Select',
    icon: 'cursor',
    group: 'pointer',
    allowed: canMove,
    panel: null,
  },
  { id: 'pan', label: 'Pan', icon: 'hand', group: 'pointer', allowed: everyone, panel: 'camera' },
  {
    id: 'measure',
    label: 'Measure',
    icon: 'ruler',
    group: 'measure',
    allowed: canView,
    panel: 'measure',
  },
  {
    id: 'create-prop',
    label: 'Create Prop',
    icon: 'cube',
    group: 'create',
    allowed: canEdit,
    panel: 'create-prop',
  },
  {
    id: 'initiative',
    label: 'Initiative',
    icon: 'list',
    group: 'planned',
    allowed: everyone,
    panel: 'initiative',
  },
]);

export const dockTabs = createRegistry<DockTab>([
  {
    id: 'scenes',
    label: 'Scenes',
    icon: 'scenes',
    group: 'world',
    allowed: admin,
    panel: 'scenes',
  },
  {
    id: 'layers',
    label: 'Layers',
    icon: 'layers',
    group: 'world',
    allowed: admin,
    panel: 'layers',
  },
  { id: 'map', label: 'Map', icon: 'map', group: 'world', allowed: admin, panel: 'map' },
  {
    id: 'entities',
    label: 'Entities',
    icon: 'entities',
    group: 'world',
    allowed: admin,
    panel: 'entities',
  },
  {
    id: 'seats',
    label: 'Participants',
    icon: 'seats',
    group: 'table',
    allowed: host,
    panel: 'seats',
  },
  { id: 'share', label: 'Invite', icon: 'share', group: 'table', allowed: host, panel: 'share' },
]);

export const tokenQuickFields = createRegistry<TokenQuickField>([
  { id: 'hp', label: 'HP', icon: 'heart', group: 'default', allowed: canView, field: 'hp' },
  { id: 'ac', label: 'AC', icon: 'shield', group: 'default', allowed: canView, field: 'ac' },
  {
    id: 'speed',
    label: 'Speed',
    icon: 'speed',
    group: 'default',
    allowed: canView,
    field: 'speed',
  },
]);
