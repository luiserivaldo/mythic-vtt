import type { Campaign, ChatMessage } from '../schema/index.js';
import type { Audience } from './audience.js';

/** PERM-03: only the host archive can inspect every whisper; co-DMs are not whisper recipients. */
export function canReadChat(audience: Audience, state: Campaign, message: ChatMessage): boolean {
  if (audience.kind === 'host') return true;
  if (audience.kind === 'seat' && !state.seats[audience.seatId]?.permissions.view) return false;
  if (message.audience.kind === 'public') return true;
  if (audience.kind !== 'seat') return false;
  if (message.author.kind === 'seat' && message.author.seatId === audience.seatId) return true;
  return message.audience.kind === 'whisper'
    ? message.audience.seatId === audience.seatId
    : state.seats[audience.seatId]?.role === 'codm';
}
