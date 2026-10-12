import { resolvePlayerToggles, type Campaign, type PlayerToggle } from '../schema/index.js';
import { isCoDm, isHost, seatOf } from './define.js';
import type { Actor } from './envelope.js';

/**
 * PERM-05: ephemeral channels that a scene toggle gates. MV-155 (drawing) and MV-156 (pings)
 * register their channels here so the host relay enforces them without a second code path.
 */
export const TOGGLE_FOR_CHANNEL: Readonly<Record<string, PlayerToggle>> = {
  'ruler.preview': 'measure',
};

/**
 * May this actor use a scene-gated player ability? The host and co-DMs are never limited by the
 * toggles. A player needs the scene toggle AND the seat-level UI-SEAT-05 switch; spectators,
 * mods, unknown seats and unknown scenes get nothing.
 */
export function canUseSceneToggle(
  state: Campaign,
  actor: Actor,
  sceneId: string,
  toggle: PlayerToggle,
): boolean {
  const scene = state.scenes[sceneId];
  if (!scene) return false;
  if (isHost(actor)) return true;
  const seat = seatOf(state, actor);
  if (!seat) return false;
  if (seat.interactionEnabled === false) return false;
  if (isCoDm(state, actor)) return true;
  return resolvePlayerToggles(scene)[toggle];
}
