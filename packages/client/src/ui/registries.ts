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

/**
 * UI-SHELL-05: the shell regions a tool panel can open in. `left-pane` sits beside the rail
 * (principle 3); `right-dock` is the dock's context slot under the active tab.
 */
export type PanelRegion = 'left-pane' | 'right-dock';

/** A tool panel (rail tool options or a selection-driven panel) and the region it opens in. */
export interface ToolPanel extends RegistryEntry {
  region: PanelRegion;
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
/** UX-40: a tab kept in the registry but offered to nobody (hidden in the alpha). */
const hiddenInAlpha: Allowed = () => false;
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
    id: 'draw',
    label: 'Draw',
    icon: 'pen',
    group: 'measure',
    allowed: canView,
    panel: 'draw',
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
    group: 'encounter',
    allowed: everyone,
    panel: 'initiative',
  },
]);

export const dockTabs = createRegistry<DockTab>([
  { id: 'chat', label: 'Chat', icon: 'chat', group: 'play', allowed: everyone, panel: 'chat' },
  { id: 'sheet', label: 'Sheet', icon: 'sheet', group: 'play', allowed: everyone, panel: 'sheet' },
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
  {
    id: 'entities',
    label: 'Entities',
    icon: 'entities',
    group: 'world',
    allowed: admin,
    panel: 'entities',
  },
  {
    id: 'prefabs',
    label: 'Prefabs',
    icon: 'prefabs',
    group: 'world',
    // UX-40: hidden until better 3D modelling tools exist; the panel code stays.
    allowed: hiddenInAlpha,
    panel: 'prefabs',
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
  { id: 'help', label: 'Help', icon: 'help', group: 'info', allowed: everyone, panel: 'help' },
  {
    id: 'settings',
    label: 'Settings',
    icon: 'settings',
    group: 'info',
    allowed: everyone,
    panel: 'settings',
  },
]);

// Who sees a panel is decided where it renders (selection, the active rail tool, read-only seats)
// and the host re-checks every intent, so the predicate here only places it. Moving a panel to
// another region is a one-word change to `region` (MV-254, MV-255).
export const toolPanels = createRegistry<ToolPanel>([
  {
    id: 'transform',
    label: 'Transform',
    icon: 'move',
    group: 'selection',
    allowed: everyone,
    region: 'right-dock',
  },
  {
    id: 'aoe',
    label: 'AoE',
    icon: 'aoe',
    group: 'selection',
    allowed: everyone,
    region: 'right-dock',
  },
  {
    id: 'token',
    label: 'Token',
    icon: 'token',
    group: 'selection',
    allowed: everyone,
    region: 'right-dock',
  },
  {
    id: 'ruler',
    label: 'Ruler',
    icon: 'ruler',
    group: 'rail',
    allowed: everyone,
    region: 'right-dock',
  },
  {
    id: 'draw',
    label: 'Draw',
    icon: 'pen',
    group: 'rail',
    allowed: everyone,
    region: 'right-dock',
  },
  {
    id: 'create-prop',
    label: 'Create Prop',
    icon: 'cube',
    group: 'rail',
    allowed: everyone,
    region: 'right-dock',
  },
  {
    id: 'initiative',
    label: 'Initiative',
    icon: 'list',
    group: 'rail',
    allowed: everyone,
    // UX-38 / MV-265: quick, frequently used tooling lives in the left pane, beside the rail.
    region: 'left-pane',
  },
]);

export const tokenQuickFields = createRegistry<TokenQuickField>([
  {
    id: 'hp',
    label: 'HP',
    icon: 'heart',
    group: 'default',
    allowed: (role, permissions) => role === 'observer' || canView(role, permissions),
    field: 'hp',
  },
  {
    id: 'ac',
    label: 'AC',
    icon: 'shield',
    group: 'default',
    allowed: (role, permissions) => role === 'observer' || canView(role, permissions),
    field: 'ac',
  },
  {
    id: 'speed',
    label: 'Speed',
    icon: 'speed',
    group: 'default',
    allowed: (role, permissions) => role === 'observer' || canView(role, permissions),
    field: 'speed',
  },
]);
