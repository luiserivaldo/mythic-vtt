/**
 * UI-TOKEN-07 (MV-266): a selection's panels open in the left pane, which sits in flow and so
 * narrows the board. Opening it under a pointer that is still pressing, or between the two clicks
 * of a double-click, would move the board under that pointer: the drag would jump and the second
 * click would miss the token it means to focus (UI-INPUT). The pane therefore opens for a new
 * selection once the pointer is up and the double-click window has passed.
 */
export const DOUBLE_CLICK_MS = 400;

export interface PressState {
  /** `performance.now()` of the last pointer press anywhere in the window. */
  lastPress: number;
  /** Whether any pointer button is still held. */
  held: boolean;
}

/** Milliseconds until a new selection's panels may open: 0 now, Infinity while a button is held. */
export function revealDelay(press: PressState, now: number): number {
  if (press.held) return Infinity;
  return Math.max(0, press.lastPress + DOUBLE_CLICK_MS - now);
}

const press: PressState = { lastPress: -Infinity, held: false };
/** Pointers pressed on the window and not yet released: a second finger in a pinch is its own. */
const down = new Set<number>();

if (typeof window !== 'undefined') {
  const track = (pointerId: number, pressed: boolean) => {
    if (pressed) down.add(pointerId);
    else down.delete(pointerId);
    press.held = down.size > 0;
  };
  window.addEventListener(
    'pointerdown',
    (event) => {
      press.lastPress = performance.now();
      track(event.pointerId, true);
    },
    true,
  );
  const release = (event: PointerEvent) => {
    track(event.pointerId, false);
  };
  window.addEventListener('pointerup', release, true);
  window.addEventListener('pointercancel', release, true);
  // A release the window never saw (outside it, or swallowed) must not hold the pane shut.
  window.addEventListener(
    'pointermove',
    (event) => {
      if (event.buttons === 0 && down.has(event.pointerId)) track(event.pointerId, false);
    },
    true,
  );
}

/** The live delay for the current window's pointer. */
export function selectionRevealDelay(): number {
  return revealDelay(press, performance.now());
}

/**
 * Runs `reveal` once the pointer gate allows a board-moving layout change (at once if it already
 * does). Returns the cleanup that cancels a pending reveal.
 */
export function whenRevealable(reveal: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const check = () => {
    const wait = selectionRevealDelay();
    if (wait <= 0) reveal();
    else timer = setTimeout(check, Number.isFinite(wait) ? wait : 50);
  };
  check();
  return () => {
    clearTimeout(timer);
  };
}
