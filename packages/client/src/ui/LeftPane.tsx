import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { selectionAnchorStore } from './beside-token.js';
import { leftPaneStore, PANE_MARGIN_PX, paneShift } from './left-pane.js';

/**
 * UI-SHELL-05: the collapsible left pane. MV-279 (UX-49): it floats over the board's left edge,
 * just right of the floating rail, so opening, collapsing or closing it never changes the board's
 * size or position and a pointer on the board keeps landing on what it aimed at. Where it would
 * cover a selected token or its handles it moves right, just past them (`paneShift`). Only a
 * token: the selection anchor is a token-sized footprint, so for a wide battlemap the move could
 * land on the map instead. The pane only exists while a panel registered to `left-pane` is open;
 * collapsed, it shrinks to a slim strip. The same pane serves 2D and 3D.
 */
export function LeftPane({
  children,
  avoidSelection = false,
}: {
  children: ReactNode;
  /** Whether the selection is a single token the pane should keep clear of. */
  avoidSelection?: boolean;
}) {
  const collapsed = useStore(leftPaneStore, (state) => state.collapsed);
  const ref = useRef<HTMLElement>(null);
  // The rail's right edge, measured from the pane's slot (the board's left edge), so the pane
  // never covers the rail.
  const [railClearance, setRailClearance] = useState(0);
  const [shift, setShift] = useState(0);

  useLayoutEffect(() => {
    const pane = ref.current;
    const slot = pane?.parentElement;
    const board = slot?.parentElement?.querySelector('.ui-board');
    const rail = board?.querySelector('.ui-board-controls');
    if (!pane || !slot || !board || !rail) return;
    const place = () => {
      const right = rail.getBoundingClientRect().right - slot.getBoundingClientRect().left;
      const clearance = Math.max(0, Math.ceil(right));
      setRailClearance(clearance);
      // The selection's anchor is in board pixels, and the board starts at the slot's left edge.
      const box = {
        left: clearance + PANE_MARGIN_PX,
        top: pane.offsetTop,
        width: pane.offsetWidth,
        height: pane.offsetHeight,
      };
      const anchor = avoidSelection ? selectionAnchorStore.getState().anchor : null;
      setShift(paneShift(anchor, box, board.clientWidth));
    };
    place();
    const unsubscribe = selectionAnchorStore.subscribe(place);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    for (const element of [rail, pane, board]) observer?.observe(element);
    return () => {
      unsubscribe();
      observer?.disconnect();
    };
  }, [avoidSelection]);

  return (
    <aside
      ref={ref}
      className="ui-left-pane"
      data-collapsed={collapsed}
      aria-label="Left pane"
      style={
        {
          '--ui-rail-clearance': `${String(railClearance)}px`,
          '--ui-pane-shift': `${String(shift)}px`,
        } as CSSProperties
      }
    >
      <div className="ui-left-pane-head">
        <button
          type="button"
          aria-label={collapsed ? 'Expand left pane' : 'Collapse left pane'}
          aria-expanded={!collapsed}
          onClick={() => {
            leftPaneStore.getState().toggleCollapsed();
          }}
        >
          {collapsed ? '›' : '‹'}
        </button>
      </div>
      <div className="ui-left-pane-content" hidden={collapsed}>
        {children}
      </div>
    </aside>
  );
}
