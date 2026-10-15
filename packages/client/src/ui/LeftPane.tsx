import type { ReactNode } from 'react';
import { useStore } from 'zustand';
import { leftPaneStore } from './left-pane.js';

/**
 * UI-SHELL-05: the collapsible left pane, in normal flow between the left edge and the board, so
 * the floating rail sits on its edge and a tool's panel opens beside its button (principle 3).
 * It only exists while a panel registered to `left-pane` is open; collapsed, it shrinks to a slim
 * strip and the board widens. The same pane serves 2D and 3D.
 */
export function LeftPane({ children }: { children: ReactNode }) {
  const collapsed = useStore(leftPaneStore, (state) => state.collapsed);
  return (
    <aside className="ui-left-pane" data-collapsed={collapsed} aria-label="Left pane">
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
