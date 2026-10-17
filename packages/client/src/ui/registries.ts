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
  /** Offered only in this local view mode (C16: the hierarchy is a 3D edit-mode tab). */
  view?: '2d' | '3d';
}

export interface TokenQuickField extends RegistryEntry {
  field: string;
}

/**
 * UI-SHELL-05: the shell regions a tool panel can open in (principle 3). `left-pane` sits beside
 * the rail; `beside-rail` floats over the board beside the tool's rail button; `beside-token`
 * floats next to the selected entity (UI-TOKEN-02). The right dock holds tabs only (MV-239), so
 * it is deliberately not a region.
 */
export type PanelRegion = 'left-pane' | 'beside-rail' | 'beside-token';

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
    // MV-290: creating props is DM work (entity.create is admin-only); a seat's Edit covers tokens.
    allowed: admin,
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
    id: 'hierarchy',
    label: 'Hierarchy',
    icon: 'hierarchy',
    group: 'world',
    allowed: admin,
    panel: 'hierarchy',
    view: '3d',
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
    label: 'Seats', // UI-SEAT-01
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
// another region is a one-word change to `region` (MV-254, MV-255). No panel opens in the right
// dock (MV-239): rail panels open beside their button or in the left pane. UI-TOKEN-07 (MV-266):
// the selection's panels (Transform, AoE, Token) open in the left pane too, under the active
// tool's panel, so they never cover the board.
export const toolPanels = createRegistry<ToolPanel>([
  {
    id: 'transform',
    label: 'Transform',
    icon: 'move',
    group: 'selection',
    allowed: everyone,
    region: 'left-pane',
  },
  {
    id: 'aoe',
    label: 'AoE',
    icon: 'aoe',
    group: 'selection',
    allowed: everyone,
    region: 'left-pane',
  },
  {
    id: 'token',
    label: 'Token',
    icon: 'token',
    group: 'selection',
    allowed: everyone,
    region: 'left-pane',
  },
  {
    id: 'ruler',
    label: 'Measure',
    icon: 'ruler',
    group: 'rail',
    allowed: everyone,
    // UI-MEAS-01 / MV-265: the Measure panel opens beside its rail button, not in the dock.
    region: 'beside-rail',
  },
  {
    id: 'draw',
    label: 'Draw',
    icon: 'pen',
    group: 'rail',
    allowed: everyone,
    // MV-265 / UI-SHELL-05: quick tooling beside the rail, in the left pane so the panel never
    // covers the board being drawn on (MV-239 removed the dock slot).
    region: 'left-pane',
  },
  {
    id: 'create-prop',
    label: 'Create Prop',
    icon: 'cube',
    group: 'rail',
    allowed: everyone,
    // C17 / UX-39: Create Prop options live in the left pane (MV-239 removed the dock slot).
    region: 'left-pane',
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
  {
    id: 'camera',
    label: 'Camera',
    icon: 'hand',
    group: 'rail',
    allowed: everyone,
    // UI-CAM-01 (UX-17): the Pan tool's 3D camera joystick, an expandable bar in the left pane.
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
