import type { Campaign, Prefab } from '../schema/index.js';
import { viewPrefab } from '../visibility/visible-to.js';
import { isHost, seatOf } from './define.js';
import type { Actor } from './envelope.js';

/** A guessed library ID must not expose an unreadable blueprint through placement. */
export function canReadPrefab(state: Campaign, actor: Actor, prefab: Prefab): boolean {
  if (isHost(actor)) return true;
  if (actor.kind !== 'seat' || !actor.seatId) return false;
  return viewPrefab({ kind: 'seat', seatId: actor.seatId }, prefab, seatOf(state, actor)) !== null;
}
