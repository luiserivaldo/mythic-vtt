import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { railPopoverPlacement, type PopoverPlacement } from './rail-popover.js';

/**
 * UI-MEAS-01 / MV-265: a tool panel that opens directly beside its rail button, aligned to it. It
 * floats over the board (rendered inside `.ui-board`, its positioned ancestor) instead of taking
 * width from it, so the board and the camera framing stay put while the tool is armed. It follows
 * the button when the rail, the board or the panel itself changes size.
 */
export function RailPopover({
  anchorId,
  label,
  children,
}: {
  /** The rail button's element id (`rail-tool-<id>`). */
  anchorId: string;
  label: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const [placement, setPlacement] = useState<PopoverPlacement | null>(null);

  useLayoutEffect(() => {
    const panel = ref.current;
    const frame = panel?.parentElement;
    const button = document.getElementById(anchorId);
    const rail = button?.parentElement;
    if (!panel || !frame || !button || !rail) return;
    const place = () => {
      const next = railPopoverPlacement(
        frame.getBoundingClientRect(),
        rail.getBoundingClientRect(),
        button.getBoundingClientRect(),
        panel.scrollHeight,
      );
      setPlacement((prev) =>
        prev?.left === next.left && prev.top === next.top && prev.maxHeight === next.maxHeight
          ? prev
          : next,
      );
    };
    place();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(place);
    for (const element of [frame, rail, panel]) observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [anchorId]);

  return (
    <aside
      ref={ref}
      className="ui-rail-popover"
      aria-label={label}
      data-anchor={anchorId}
      style={
        placement
          ? { left: placement.left, top: placement.top, maxHeight: placement.maxHeight }
          : { visibility: 'hidden' }
      }
    >
      {children}
    </aside>
  );
}
