import type { Id } from '../schema/index.js';

/** Who a filtered view is for. Spectators share one audience; mods come later. */
export type Audience = { kind: 'host' } | { kind: 'seat'; seatId: Id } | { kind: 'spectators' };

export function audienceKey(a: Audience): string {
  return a.kind === 'seat' ? `seat:${a.seatId}` : a.kind;
}
