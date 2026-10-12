import { useCallback, useState } from 'react';
import { UndoHotkey } from './ui/UndoHotkey.js';
import { useClientStore } from './store/react.js';
import { RightDock } from './ui/RightDock.js';
import { JoinScreen } from './ui/JoinScreen.js';
import './ui/shell.css';
import { BoardCanvas } from './render/BoardCanvas.js';
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
      <UndoHotkey />
      <header className="ui-top-bar">
        <span className="ui-scene-heading">{scene?.name ?? campaign?.name ?? 'Table'}</span>
        <IdentityStatus />
      </header>
      <div className="ui-app-body">
        <BoardCanvas panelContainer={panelContainer} />
        <RightDock theme={theme} onThemeChange={changeTheme} contextPanelRef={panelRef} />
      </div>
      <JoinScreen />
    </main>
  );
}
