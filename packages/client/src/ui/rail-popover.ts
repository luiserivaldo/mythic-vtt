// UI-MEAS-01 / MV-265: a tool panel that opens beside its rail button floats over the board, so
// arming the tool never resizes or shifts the board under the pointer. Local layout only.

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PopoverPlacement {
  left: number;
  top: number;
  maxHeight: number;
}

/** Breathing room between the rail and the panel, and between the panel and the board's edges. */
export const POPOVER_GAP = 8;

/**
 * Where a beside-the-rail panel goes, in pixels relative to the board (`frame`): just right of
 * the rail, top-aligned with its button. A panel taller than the room below the button moves up
 * until it fits, and one taller than the board scrolls (its `maxHeight`).
 */
export function railPopoverPlacement(
  frame: Box,
  rail: Box,
  button: Box,
  panelHeight: number,
): PopoverPlacement {
  const room = Math.max(0, frame.bottom - frame.top);
  const maxHeight = Math.max(0, room - 2 * POPOVER_GAP);
  const height = Math.min(Math.max(0, panelHeight), maxHeight);
  const aligned = button.top - frame.top;
  const lowest = room - POPOVER_GAP - height;
  return {
    left: rail.right - frame.left + POPOVER_GAP,
    top: Math.max(POPOVER_GAP, Math.min(aligned, lowest)),
    maxHeight,
  };
}
