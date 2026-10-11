import type { Draft } from 'immer';
import {
  CHAT_HISTORY_LIMIT,
  type Campaign,
  type ChatAudience,
  type ChatAuthor,
  type ChatMessage,
} from '../schema/index.js';
import type { Actor } from './envelope.js';
import { seatOf } from './define.js';

export function canPostChat(state: Campaign, actor: Actor, audience: ChatAudience): boolean {
  if (actor.kind !== 'host' && (actor.kind !== 'seat' || !seatOf(state, actor)?.permissions.view))
    return false;
  return audience.kind !== 'whisper' || state.seats[audience.seatId] !== undefined;
}

export function chatAuthor(state: Campaign, actor: Actor): ChatAuthor {
  if (actor.kind === 'host') return { kind: 'host', label: 'DM' };
  const seat = seatOf(state, actor);
  if (!seat) throw new Error('chat author must be seated');
  return { kind: 'seat', seatId: seat.id, label: seat.label.slice(0, 200) };
}

export function appendChat(state: Draft<Campaign>, message: ChatMessage): void {
  state.chat ??= [];
  state.chat.push(message);
  if (state.chat.length > CHAT_HISTORY_LIMIT)
    state.chat.splice(0, state.chat.length - CHAT_HISTORY_LIMIT);
}
