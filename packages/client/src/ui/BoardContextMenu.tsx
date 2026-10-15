import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { pingStore } from '../tools/ping-store.js';
import { usePingReason } from './ping-reason.js';
import { tokenMenuStore } from './token-menu-store.js';

// UX-40 / UI-TOKEN-03: the right-click menu on empty board. Today it holds one entry, Ping, like
// Roll20; the token's own right-click menu carries the same entry. Local view state only: nothing
// here is an action or is sent anywhere except the ephemeral ping the entry asks for.

interface OpenMenu {
  /** Viewport pixels of the click. */
  left: number;
  top: number;
  /** The same point in normalised device coordinates, so 2D and 3D resolve it the same way. */
  ndcX: number;
  ndcY: number;
}

const menuStyle = {
  position: 'fixed',
  zIndex: 30,
  minWidth: 160,
  margin: 0,
  padding: '0.25rem',
  listStyle: 'none',
  background: 'var(--ui-bg)',
  color: 'var(--ui-fg)',
  border: '1px solid var(--ui-border)',
  borderRadius: 6,
  boxShadow: '0 6px 18px rgba(0,0,0,0.5)',
} as const satisfies CSSProperties;

function boardCanvas(target: EventTarget | null): HTMLCanvasElement | null {
  return target instanceof HTMLCanvasElement && target.closest('.ui-board') ? target : null;
}

export function BoardContextMenu() {
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const reason = usePingReason();
  const ref = useRef<HTMLUListElement>(null);

  useEffect(() => {
    // Capture runs before the board's own handlers. A right click closes any token menu first; a
    // token that is hit re-opens its own menu while the event bubbles, so a token menu still open
    // at the bubble phase means the click was on a token and this menu stays shut.
    const onCapture = (event: MouseEvent) => {
      setMenu(null);
      if (boardCanvas(event.target)) tokenMenuStore.getState().close();
    };
    const onContextMenu = (event: MouseEvent) => {
      const canvas = boardCanvas(event.target);
      if (!canvas || tokenMenuStore.getState().contextEntityId !== null) return;
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      setMenu({
        left: event.clientX,
        top: event.clientY,
        ndcX: ((event.clientX - rect.left) / rect.width) * 2 - 1,
        ndcY: -(((event.clientY - rect.top) / rect.height) * 2 - 1),
      });
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) return;
      setMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null);
    };
    window.addEventListener('contextmenu', onCapture, true);
    window.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('contextmenu', onCapture, true);
      window.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  if (!menu) return null;
  return (
    <ul
      ref={ref}
      role="menu"
      aria-label="Board actions"
      data-testid="board-context-menu"
      style={{
        ...menuStyle,
        left: Math.min(menu.left, window.innerWidth - 180),
        top: Math.min(menu.top, window.innerHeight - 60),
      }}
    >
      <li role="none" title={reason}>
        <button
          type="button"
          role="menuitem"
          className="ui-rail-tool"
          aria-disabled={reason === undefined ? undefined : true}
          style={{ width: '100%', textAlign: 'left' }}
          onClick={() => {
            if (reason !== undefined) return;
            pingStore.getState().requestAt({ kind: 'ndc', x: menu.ndcX, y: menu.ndcY });
            setMenu(null);
          }}
        >
          Ping
        </button>
      </li>
    </ul>
  );
}
