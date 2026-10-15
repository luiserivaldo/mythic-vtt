import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { isDrag, MOUSE_RIGHT, rightReleaseOpensMenu, type Px } from './board-input.js';

interface RightPress {
  pointerId: number;
  start: Px;
  modifiers: { shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean };
  moved: boolean;
  held: boolean;
  /** The browser fired `contextmenu` while the button was still down; we owe one on release. */
  owed: boolean;
}

/**
 * UI-INPUT-04 (UX-16): a right click opens the context menu or the tool's right-click action; a
 * right drag (an orbit in 3D) never does. Browsers disagree on when `contextmenu` fires: Linux and
 * macOS on press, before anyone knows whether the press will become a drag; Windows on release.
 * This gate, mounted before every other board control, holds a press-time `contextmenu` back and
 * re-dispatches it on the canvas at release only if the press stayed within the drag threshold,
 * and drops a release-time one after a drag. Every menu and right-click action downstream (board
 * menu, token menu, ruler waypoint, AoE quick delete) therefore sees one event, only for a click.
 *
 * A right press while the left button drags a token is a chord: it fires no `pointerdown`, so the
 * gate never tracks it and the token drag keeps its checkpoint gesture (UI-TOKEN-06).
 */
export function RightClickGate() {
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    const el = gl.domElement;
    let right: RightPress | null = null;

    const onDown = (e: PointerEvent) => {
      if (e.target !== el || e.pointerType !== 'mouse') return;
      right =
        e.button === MOUSE_RIGHT
          ? {
              pointerId: e.pointerId,
              start: { x: e.clientX, y: e.clientY },
              modifiers: {
                shiftKey: e.shiftKey,
                ctrlKey: e.ctrlKey,
                altKey: e.altKey,
                metaKey: e.metaKey,
              },
              moved: false,
              held: true,
              owed: false,
            }
          : null;
    };

    const onMove = (e: PointerEvent) => {
      if (!right?.held || right.moved || e.pointerId !== right.pointerId) return;
      if (isDrag(right.start, { x: e.clientX, y: e.clientY })) right.moved = true;
    };

    const onUp = (e: PointerEvent) => {
      if (!right?.held || e.pointerId !== right.pointerId) return;
      right.held = false;
      if (!right.owed) return; // Windows: the browser's own event follows this release.
      const done = right;
      right = null;
      if (!rightReleaseOpensMenu(done.moved)) return;
      el.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
          button: MOUSE_RIGHT,
          clientX: done.start.x,
          clientY: done.start.y,
          screenX: e.screenX + done.start.x - e.clientX,
          screenY: e.screenY + done.start.y - e.clientY,
          ...done.modifiers,
        }),
      );
    };

    const onCancel = (e: PointerEvent) => {
      if (right && e.pointerId === right.pointerId) right = null;
    };

    const onContextMenu = (e: MouseEvent) => {
      // Our own re-dispatch (untrusted) and anything off the board pass straight through.
      if (!e.isTrusted || e.target !== el || !right) return;
      if (right.held) {
        right.owed = true;
      } else {
        const moved = right.moved;
        right = null;
        if (rightReleaseOpensMenu(moved)) return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
    };

    // Window capture, registered before the other board controls: it sees the press and the menu
    // event before any of them can act on it.
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    window.addEventListener('contextmenu', onContextMenu, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      window.removeEventListener('contextmenu', onContextMenu, true);
    };
  }, [gl]);

  return null;
}
