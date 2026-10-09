import type { Seat } from './schema/index.js';

export type SeatTemplateId = 'dm' | 'codm' | 'player' | 'spectator';

export interface SeatTemplate {
  id: SeatTemplateId;
  label: string;
  description: string;
  role: Seat['role'];
  permissions: Seat['permissions'];
}

/**
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
  },
  {
    id: 'codm',
    label: 'Co-DM',
    description: 'Table controls and DM-layer visibility without host credentials.',
    role: 'codm',
    permissions: { view: true, move: true, edit: true, delete: true },
  },
  {
    id: 'player',
    label: 'Player',
    description: 'Player view with movement for owned tokens.',
    role: 'player',
    permissions: { view: true, move: true, edit: false, delete: false },
  },
  {
    id: 'spectator',
    label: 'Spectator',
    description: 'Read-only player view; seat-less spectating remains available.',
    role: 'player',
    permissions: { view: true, move: false, edit: false, delete: false },
  },
];

export function seatTemplate(id: SeatTemplateId): SeatTemplate {
  const template = SEAT_TEMPLATES.find((candidate) => candidate.id === id);
  if (!template) throw new Error(`unknown seat template: ${id}`);
  return template;
}
