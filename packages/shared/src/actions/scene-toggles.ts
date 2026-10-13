import { resolvePlayerToggles, type Campaign, type PlayerToggle } from '../schema/index.js';
import { DRAW_STROKE_CHANNEL } from '../drawing.js';
import { isCoDm, isHost, seatOf } from './define.js';
import type { Actor } from './envelope.js';

/**
 * PERM-05: ephemeral channels that a scene toggle gates. `ruler.preview` (measure) and the drawing
 * stroke (draw) are the registered channels, so the host relay enforces those toggles without a
 * second code path. Erasing a drawing and clearing them are not scene-wide player permissions: the
 * host relay checks the author and the role instead (see `canEraseDrawing` / `canClearDrawings`).
 */
export const TOGGLE_FOR_CHANNEL: Readonly<Record<string, PlayerToggle>> = {
  'ruler.preview': 'measure',
  [DRAW_STROKE_CHANNEL]: 'draw',
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
