import { useEffect } from 'react';
import { useStore } from 'zustand';
import { rulerStore } from '../tools/ruler-store.js';
import { aoeToolStore } from '../tools/aoe-tool-store.js';
import { activateMeasurement } from '../tools/measurement-tool.js';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

/** Board toolbar button plus the `R` shortcut for the Ruler tool (MEAS-01). Available to everyone. */
export function RulerToggle() {
  const armed = useStore(rulerStore, (s) => s.tool);
  const aoeActive = useStore(aoeToolStore, (s) => s.active);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'r' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (isTypingTarget(e.target)) return;
      activateMeasurement(
        rulerStore.getState().tool || aoeToolStore.getState().active ? null : 'distance',
      );
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
        aria-pressed={armed || aoeActive}
        title="Measure distance (R). Drag for a quick measure; click for waypoints; Esc clears"
        onClick={() => {
          activateMeasurement(armed || aoeActive ? null : 'distance');
        }}
      >
        Ruler
      </button>
    </>
  );
}
