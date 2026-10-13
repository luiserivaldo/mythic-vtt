import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { useJoinEnv } from './join-context.js';
import { createViewerPreferencesStore } from './viewer-preferences.js';

const PreferencesContext = createContext<ReturnType<typeof createViewerPreferencesStore> | null>(
  null,
);

/** UI-SET-01: local presentation preferences shared with UI consumers, never campaign state. */
export function ViewerPreferencesProvider({ children }: { children: ReactNode }) {
  const env = useJoinEnv();
  const store = useMemo(
    () =>
      createViewerPreferencesStore(
        env?.storage ?? { getItem: () => null, setItem: () => undefined },
        // Credential-bound spectators have a temporary transport identity on each visit.
        env?.readOnlyVisitor ? 'spectator' : (env?.identityId ?? 'viewer'),
      ),
    [env],
  );
  return <PreferencesContext.Provider value={store}>{children}</PreferencesContext.Provider>;
}

export function useViewerPreferences() {
  const store = useContext(PreferencesContext);
  if (!store) throw new Error('Viewer preferences provider missing');
  return useStore(store);
}
