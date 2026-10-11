import { useEffect } from 'react';
import { useViewMode, viewModeStore } from './view-mode-store.js';
import { isTypingTarget } from './typing-target.js';

/** Board toolbar button plus the `3` shortcut for the 2D <-> 3D toggle. Available to everyone. */
export function ViewToggle() {
  const mode = useViewMode();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '3' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (isTypingTarget(e.target)) return;
      viewModeStore.getState().toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  return (
    <button
      type="button"
      aria-pressed={mode === '3d'}
      title="Toggle 2D / 3D view (3)"
      onClick={() => {
        viewModeStore.getState().toggle();
      }}
    >
      3D view
    </button>
  );
}
