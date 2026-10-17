import type { SeatPermissions, SeatTool } from '@mythic/shared';
import { railTools } from './registries.js';
import type { ViewerRole } from './viewer.js';

// UI-TOOL-07 (PERM-05): a tool a seat may not use is disabled with a reason, never hidden. The
// registry says who may use a tool; this adds the seat's Enable Interaction switch and the seat's
// own tool permissions (UI-SEAT-02), and works out the wording. Nothing here is authority: the host re-checks
// every intent.

export interface RailToolState {
  id: string;
  label: string;
  icon: string;
  group: string;
  panel: string | null;
  enabled: boolean;
  /** Why the tool is disabled; always present when `enabled` is false. */
  reason?: string;
  /** A planned tool shown as a greyed, labelled placeholder (UI-TOOL-05). */
  wip: boolean;
  /** Draw a divider above this tool (a new registry group starts here). */
  dividerBefore: boolean;
}

export interface RailInput {
  role: ViewerRole;
  permissions: SeatPermissions | null;
  /** M1-44: a spectator or a view-only seat only gets camera controls (Pan). */
  readOnly?: boolean;
  /** The viewer's seat has Enable Interaction on (always true for the host and seat-less viewers). */
  interactionEnabled: boolean;
  /** Seat-tool reasons by tool id (UI-SEAT-02), for tools the registry would otherwise allow. */
  toolReasons?: Readonly<Record<string, string | undefined>>;
}

const DENIED: Readonly<Record<string, string>> = {
  select: 'Your seat cannot move tokens',
  measure: 'Your seat cannot measure',
  draw: 'Your seat cannot draw',
  'create-prop': 'Only the DM can create props',
};

export const INTERACTION_OFF_REASON = 'Interaction is turned off for your seat';
export const SPECTATOR_REASON = 'Spectators can only look around';
export const READ_ONLY_REASON = 'Your seat is view-only';

/** UI-TOOL-07 / UI-SEAT-02 (UX-46): why a seat tool is off. The DM sets it per seat in Seats. */
export const SEAT_TOOL_OFF_REASON: Readonly<Record<SeatTool, string>> = {
  measure: 'The DM has turned off Measure for your seat',
  draw: 'The DM has turned off Draw for your seat',
  pins: 'The DM has turned off Ping for your seat',
};

/** Tools that act on the board; a read-only viewer keeps only Pan (and the placeholder). */
const ACTS_ON_BOARD: ReadonlySet<string> = new Set(['select', 'measure', 'draw', 'create-prop']);

/** The whole rail, in registry order, each tool enabled or disabled with a reason. */
export function railToolStates(input: RailInput): RailToolState[] {
  let previousGroup: string | undefined;
  return railTools.all().map((tool) => {
    const dividerBefore = previousGroup !== undefined && previousGroup !== tool.group;
    previousGroup = tool.group;
    let reason: string | undefined;
    if (!input.interactionEnabled) reason = INTERACTION_OFF_REASON;
    else if (input.readOnly === true && ACTS_ON_BOARD.has(tool.id))
      reason = input.role === 'observer' ? SPECTATOR_REASON : READ_ONLY_REASON;
    else if (!tool.allowed(input.role, input.permissions))
      reason = input.role === 'observer' ? SPECTATOR_REASON : (DENIED[tool.id] ?? 'Not available');
    else reason = input.toolReasons?.[tool.id];
    return {
      id: tool.id,
      label: tool.label,
      icon: tool.icon,
      group: tool.group,
      panel: tool.panel,
      enabled: reason === undefined,
      ...(reason !== undefined ? { reason } : {}),
      wip: tool.group === 'planned',
      dividerBefore,
    };
  });
}

/**
 * The tool that should be active: the requested one if the viewer can still use it, otherwise the
 * first usable default (Select, then Pan). When nothing is usable Select stays nominally active.
 */
export function resolveActiveTool(states: readonly RailToolState[], requested: string): string {
  const usable = (id: string) => states.find((state) => state.id === id)?.enabled === true;
  if (usable(requested)) return requested;
  return ['select', 'pan'].find(usable) ?? 'select';
}
