import { resolveSeatTools, type Campaign, type SeatTool } from '../schema/index.js';
import { DRAW_STROKE_CHANNEL } from '../drawing.js';
import { isCoDm, isHost, seatOf } from './define.js';
import type { Actor } from './envelope.js';

/**
 * LAY-05: the ephemeral ping marker's channel. The ping payload is `{ sceneId, x, y, z }` plus the
 * relay's `color`; it never enters campaign state, the action log or a save (TECHNICAL.md §4.3).
 */
export const PING_CHANNEL = 'ping';

/** PERM-05 / UI-SEAT-02: the seat tool that gates pings ("Place pins"). */
export const PING_TOOL: SeatTool = 'pins';

/**
 * PERM-05: ephemeral channels that a seat tool gates. `ruler.preview` (measure), the drawing
 * stroke (draw) and pings (pins) are the registered channels, so the host relay enforces the
 * seat's tools without a second code path. Erasing a drawing and clearing them are not tool
 * permissions: the host relay checks the author and the role instead (see `canEraseDrawing` /
 * `canClearDrawings`).
 */
export const TOOL_FOR_CHANNEL: Readonly<Record<string, SeatTool>> = {
  'ruler.preview': 'measure',
  [DRAW_STROKE_CHANNEL]: 'draw',
  [PING_CHANNEL]: PING_TOOL,
};

/**
 * UI-SEAT-02 (UX-46): may this actor use a board tool in this scene? This is the one effective
 * permission: the host evaluates it for every gated action and relay channel, and clients call it
 * only to grey out their own rail (UI-TOOL-07). The host and co-DMs are never limited. A player
 * needs their own seat's tool AND the seat-level UI-SEAT-05 switch; spectators, mods, unknown
 * seats and unknown scenes get nothing. There is no scene-wide or table-wide switch (MV-251).
 */
export function canUseTool(
  state: Campaign,
  actor: Actor,
  sceneId: string,
  tool: SeatTool,
): boolean {
  if (!state.scenes[sceneId]) return false;
  if (isHost(actor)) return true;
  const seat = seatOf(state, actor);
  if (!seat) return false;
  if (seat.interactionEnabled === false) return false;
  if (isCoDm(state, actor)) return true;
  return resolveSeatTools(seat)[tool];
}
