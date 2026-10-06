import { createContext } from 'react';
import type { Session } from './session.js';

/** Ephemeral channel access for board tools (M1-07); null until a session exists (tests). */
export interface EphemeralApi {
  send: Session['sendEphemeral'];
  on: Session['onEphemeral'];
}

export const EphemeralContext = createContext<EphemeralApi | null>(null);
