import type { Entity, Seat } from '../schema/index.js';
import type { Audience } from './audience.js';

/** TOK-04/06: marker editing uses exactly the label audience, including unnamed tokens. */
export function canReadTokenLabel(audience: Audience, entity: Entity, seat?: Seat): boolean {
  if (audience.kind === 'host') return true;
  const label = entity.token?.labelVisibility;
  if (!label || label === 'all') return true;
  const coDm = audience.kind === 'seat' && seat?.role === 'codm';
  if (coDm) return true;
  return label === 'owner' && audience.kind === 'seat' && entity.owners.includes(audience.seatId);
}
