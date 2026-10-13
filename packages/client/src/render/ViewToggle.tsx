import { useEffect } from 'react';
import { useViewMode, viewModeStore } from './view-mode-store.js';
import { isTypingTarget } from './typing-target.js';

/** Top-bar segmented control plus the `3` shortcut for the 2D <-> 3D toggle. Available to everyone. */
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
    <div role="group" aria-label="View mode" className="ui-view-mode">
      {(['2d', '3d'] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-label={value === '2d' ? '2D view' : '3D view'}
          aria-pressed={mode === value}
          onClick={() => {
            viewModeStore.getState().set(value);
          }}
        >
          {value === '2d' ? '2D' : '3D'}
        </button>
      ))}
    </div>
  );
}
