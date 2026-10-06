import { useEffect } from 'react';
import { useStore } from 'zustand';
import { rulerStore } from '../tools/ruler-store.js';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

/** Board toolbar button plus the `R` shortcut for the Ruler tool (MEAS-01). Available to everyone. */
export function RulerToggle() {
  const armed = useStore(rulerStore, (s) => s.tool);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'r' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (isTypingTarget(e.target)) return;
      rulerStore.getState().setTool(!rulerStore.getState().tool);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  return (
    <button
      type="button"
      aria-pressed={armed}
      title="Measure distance (R). Click for waypoints, double-click or Enter to finish, Esc to cancel"
      onClick={() => {
        rulerStore.getState().setTool(!armed);
      }}
    >
      Ruler
    </button>
  );
}
