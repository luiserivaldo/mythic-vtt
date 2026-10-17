import { PLAYER_TEMPLATE_TOOLS, type Seat, type SeatTools } from './schema/index.js';

export type SeatTemplateId = 'dm' | 'codm' | 'player' | 'spectator';

export interface SeatTemplate {
  id: SeatTemplateId;
  label: string;
  description: string;
  role: Seat['role'];
  permissions: Seat['permissions'];
  /** UI-SEAT-02 (UX-46): the board tools a new seat starts with; each seat then overrides them. */
  tools: SeatTools;
}

// MV-303 Q1 / MV-310 Q4: no template may interact with objects (doors are the first); the DM grants
// `interact` per seat (co-DMs ignore tools).
const ALL_TOOLS: SeatTools = { measure: true, draw: true, pins: true, interact: false };

/**
 * UX-46 (MV-251): these are the permission templates. A new seat copies its template's
 * `permissions` and `tools` once, at creation; the DM then overrides each seat in the Seats tab.
 * There is no table-wide ruleset: changing one seat never changes another.
 *
 * M1-44: presets use the existing seat contract. The DM-layer and prop-creation capability is
 * represented by `codm`; the spectator preset is a read-only player-view slot. Truly seat-less
 * spectators remain the default join option and are not stored in campaign state (Q24).
 */
export const SEAT_TEMPLATES: readonly SeatTemplate[] = [
  {
    id: 'dm',
    label: 'DM / Admin',
    description: 'Full table controls and DM-layer visibility.',
    role: 'codm',
    permissions: { view: true, move: true, edit: true, delete: true },
    tools: { ...ALL_TOOLS },
  },
  {
    id: 'codm',
    label: 'Co-DM',
    description: 'Table controls and DM-layer visibility without host credentials.',
    role: 'codm',
    permissions: { view: true, move: true, edit: true, delete: true },
    tools: { ...ALL_TOOLS },
  },
  {
    id: 'player',
    label: 'Player',
    description: 'Player view with movement for owned tokens.',
    role: 'player',
    permissions: { view: true, move: true, edit: false, delete: false },
    tools: { ...PLAYER_TEMPLATE_TOOLS },
  },
  {
    id: 'spectator',
    label: 'Spectator',
    description: 'Read-only player view; seat-less spectating remains available.',
    role: 'player',
    permissions: { view: true, move: false, edit: false, delete: false },
    tools: { measure: false, draw: false, pins: false, interact: false },
  },
];

export function seatTemplate(id: SeatTemplateId): SeatTemplate {
  const template = SEAT_TEMPLATES.find((candidate) => candidate.id === id);
  if (!template) throw new Error(`unknown seat template: ${id}`);
  return template;
}
