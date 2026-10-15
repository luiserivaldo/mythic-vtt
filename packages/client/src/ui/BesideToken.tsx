import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { BESIDE_MARGIN_PX, besideTokenPlacement, selectionAnchorStore } from './beside-token.js';

/**
 * UI-TOKEN-02 / principle 3 (MV-239): the selected entity's panels (Transform, AoE, Token) float
 * over the board beside it and follow it as the camera or the token moves, instead of opening in
 * the right dock. Rendered as a child of the board, so it is positioned in the board's own
 * coordinates and never resizes it. Placement is written straight to the element's style: the
 * canvas reports the anchor on every rendered frame, and re-rendering the panels for each one
 * would be wasted work.
 */
export function BesideToken({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    const board = element?.parentElement;
    if (!element || !board) return;
    const place = () => {
      const boardBox = board.getBoundingClientRect();
      const rail = board.querySelector('.ui-board-controls')?.getBoundingClientRect();
      const minLeft = (rail ? rail.right - boardBox.left : 0) + BESIDE_MARGIN_PX;
      const anchor = selectionAnchorStore.getState().anchor;
      const { left, top } = besideTokenPlacement(
        anchor,
        { width: element.offsetWidth, height: element.offsetHeight },
        { width: board.clientWidth, height: board.clientHeight },
        minLeft,
      );
      element.style.left = `${String(left)}px`;
      element.style.top = `${String(top)}px`;
      element.dataset.anchored = String(anchor !== null);
    };
    place();
    const unsubscribe = selectionAnchorStore.subscribe(place);
    // The panels change size as they load, collapse or restore; the board resizes with the docks.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    observer?.observe(element);
    observer?.observe(board);
    return () => {
      unsubscribe();
      observer?.disconnect();
    };
  }, []);
  return (
    <aside ref={ref} className="ui-beside-token" aria-label="Selection panels">
      {children}
    </aside>
  );
}
