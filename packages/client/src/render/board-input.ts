/**
 * UI-INPUT-01..04 (UX-16): the board's mouse mapping in one place. Each control (camera, marquee,
 * token drag, context menu) asks here what a press means instead of re-deriving it, so the
 * buttons stay consistent between 2D and 3D.
 *
 * - Left selects and moves. It pans only while the Pan tool is active (UI-TOOL-02); with the
 *   Select tool a left-drag on empty board draws the marquee (UI-TOOL-01, C13).
 * - Wheel zooms.
 * - Middle-drag pans; a middle click on a selected token toggles its flying lock (Q26).
 * - Right-drag orbits in 3D; a right click opens the context menu or the tool's right-click
 *   action. Nothing orbits in 2D.
 *
 * Touch and pen keep their gesture mapping (one contact pans in 2D, orbits in 3D); the alpha is
 * desktop only, so they are not tuned further here.
 */

export interface Px {
  x: number;
  y: number;
}

export type BoardView = '2d' | '3d';

/** The one movement (px) that separates a click from a drag, for every button and control. */
export const DRAG_THRESHOLD_PX = 4;

/** True once a press has moved far enough from where it started to count as a drag. */
export function isDrag(start: Px, now: Px): boolean {
  return Math.hypot(now.x - start.x, now.y - start.y) >= DRAG_THRESHOLD_PX;
}

export const MOUSE_LEFT = 0;
export const MOUSE_MIDDLE = 1;
export const MOUSE_RIGHT = 2;

/** What the camera does with a press it is offered (after tools and gizmos have had first pick). */
export type CameraPress = 'pan' | 'orbit';

/**
 * The camera's share of a press. `tool` is the rail tool in effect (`select`, `pan`, `measure`,
 * …); only Pan lets the left button move the camera.
 */
export function cameraPress(
  view: BoardView,
  pointerType: string,
  button: number,
  tool: string,
): CameraPress | null {
  if (pointerType !== 'mouse') return view === '3d' ? 'orbit' : 'pan';
  if (button === MOUSE_MIDDLE) return 'pan';
  if (button === MOUSE_RIGHT) return view === '3d' ? 'orbit' : null;
  if (button === MOUSE_LEFT && tool === 'pan') return 'pan';
  return null;
}

/**
 * What an unclaimed left drag on empty board does with the tool in effect. Create Prop acts like
 * Select on the board (MV-271): its props come from the left pane's shape icons, not board clicks.
 */
export function emptyBoardLeftDrag(tool: string): 'marquee' | 'pan' | null {
  if (tool === 'select' || tool === 'create-prop') return 'marquee';
  if (tool === 'pan') return 'pan';
  return null;
}

/**
 * Right button: a click (released within the threshold) opens the context menu or the tool's
 * right-click action; a drag never does, in 2D or 3D (in 3D it orbited instead).
 */
export function rightReleaseOpensMenu(moved: boolean): boolean {
  return !moved;
}
