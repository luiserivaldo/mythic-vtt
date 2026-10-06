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
  initialProfile: Profile | null;
}

export const JoinContext = createContext<JoinEnv | null>(null);

export function useJoinEnv(): JoinEnv | null {
  return useContext(JoinContext);
}
