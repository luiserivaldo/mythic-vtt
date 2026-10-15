import { useCallback, useState } from 'react';
import { UndoHotkey } from './ui/UndoHotkey.js';
import { useClientStore } from './store/react.js';
import { RightDock } from './ui/RightDock.js';
import { leftPaneStore } from './ui/left-pane.js';
import { JoinScreen } from './ui/JoinScreen.js';
import { SignedOutScreen } from './ui/CampaignThumbnailControls.js';
import './ui/shell.css';
import { BoardCanvas } from './render/BoardCanvas.js';
import { TopBar } from './ui/TopBar.js';

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
  const leftPaneRef = useCallback((node: HTMLDivElement | null) => {
    leftPaneStore.getState().setContainer(node);
  }, []);

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
      <TopBar />
      <div className="ui-app-body">
        {/* UI-SHELL-05: the left pane portals in here; empty, the slot takes no width. */}
        <div className="ui-left-pane-slot" ref={leftPaneRef} />
        <BoardCanvas />
        <RightDock theme={theme} onThemeChange={changeTheme} />
      </div>
      <JoinScreen />
      <SignedOutScreen />
    </main>
  );
}
