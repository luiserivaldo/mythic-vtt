import { createContext, useContext } from 'react';
import type { KeyValueStore } from '../net/identity.js';
import type { Profile } from './join-screen.js';
import type { Session } from './session.js';

export interface JoinEnv {
  session: Session;
  storage: KeyValueStore;
  identityId: string;
  /** DM-link or remembered host: skips the join screen entirely. */
  hostVisitor: boolean;
  /** SES-11: credential-bound spectators cannot switch identities or claim seats. */
  readOnlyVisitor?: boolean;
  initialProfile: Profile | null;
  /** Just replaced its identity (transfer): ask for a name and let the host restore the seat. */
  returning?: boolean;
}

/** Set by an identity transfer just before it reloads the page; read once on start. */
export const RETURNING_KEY = 'mythic.join.returning';

export const JoinContext = createContext<JoinEnv | null>(null);

export function useJoinEnv(): JoinEnv | null {
  return useContext(JoinContext);
}
