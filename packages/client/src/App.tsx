import { useCallback, useState } from 'react';
import { useClientStore } from './store/react.js';
import { DmPanels } from './ui/DmPanels.js';
import { JoinScreen } from './ui/JoinScreen.js';
import './ui/shell.css';
import { BoardCanvas } from './render/BoardCanvas.js';
import { IdentityTransfer } from './ui/IdentityTransfer.js';
import { IdentityStatus } from './ui/IdentityStatus.js';

const THEME_KEY = 'mythic.theme';
type Theme = 'dark' | 'light';

function initialTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** UI-SHELL-01/02: the board owns the remaining width; each viewer owns their own chrome. */
export function App() {
  const connection = useClientStore((s) => s.connection);
  const ready = useClientStore((s) => s.ready);
  const campaign = useClientStore((s) => s.campaign);
  const fatalError = useClientStore((s) => s.fatalError);
  const [collapsed, setCollapsed] = useState(false);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [panelContainer, setPanelContainer] = useState<HTMLDivElement | null>(null);
  const panelRef = useCallback((node: HTMLDivElement | null) => {
    setPanelContainer(node);
  }, []);
  const scene = campaign?.activeSceneId ? campaign.scenes[campaign.activeSceneId] : null;

  const changeTheme = (next: Theme) => {
    setTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage is optional; this viewer can still change the current session.
    }
  };

  return (
    <main className="ui-app" data-theme={theme}>
      <p role="status" className="ui-visually-hidden">
        {fatalError ??
          (ready ? `Connected to ${campaign?.name ?? 'table'}` : `Connection: ${connection}`)}
      </p>
      {fatalError && (
        <p role="alert" className="ui-shell-error">
          {fatalError}
        </p>
      )}
      <header className="ui-top-bar">
        <span className="ui-scene-heading">{scene?.name ?? campaign?.name ?? 'Table'}</span>
        <IdentityStatus />
      </header>
      <div className="ui-app-body">
        <BoardCanvas panelContainer={panelContainer} />
        <aside className="ui-right-dock" data-collapsed={collapsed} aria-label="Right dock">
          <div className="ui-right-dock-head">
            <button
              type="button"
              aria-label={collapsed ? 'Expand dock' : 'Collapse dock'}
              aria-expanded={!collapsed}
              onClick={() => {
                setCollapsed((value) => !value);
              }}
            >
              {collapsed ? '›' : '‹'}
            </button>
            {!collapsed && <strong>Panels</strong>}
          </div>
          <div className="ui-right-dock-content" hidden={collapsed}>
            <DmPanels />
            <details className="ui-settings">
              <summary>Settings</summary>
              <fieldset>
                <legend>Appearance</legend>
                <label>
                  <input
                    type="radio"
                    name="theme"
                    checked={theme === 'dark'}
                    onChange={() => {
                      changeTheme('dark');
                    }}
                  />
                  Dark
                </label>
                <label>
                  <input
                    type="radio"
                    name="theme"
                    checked={theme === 'light'}
                    onChange={() => {
                      changeTheme('light');
                    }}
                  />
                  Light
                </label>
              </fieldset>
            </details>
            {ready && <IdentityTransfer />}
            <div className="ui-context-panel-slot" ref={panelRef} />
          </div>
        </aside>
      </div>
      <JoinScreen />
    </main>
  );
}
