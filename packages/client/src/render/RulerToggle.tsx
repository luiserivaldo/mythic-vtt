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
  const persistent = useStore(rulerStore, (s) => s.persistent);
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
    <>
      <button
        type="button"
        aria-pressed={armed}
        title="Measure distance (R). Drag for a quick measure; click for waypoints; Esc clears"
        onClick={() => {
          rulerStore.getState().setTool(!armed);
        }}
      >
        Ruler
      </button>
      <label title="Keep a completed ruler until the next measure or right click">
        <input
          type="checkbox"
          checked={persistent}
          onChange={(event) => {
            rulerStore.getState().setPersistent(event.currentTarget.checked);
          }}
        />
        Persistent
      </label>
    </>
  );
}
