import { createContext } from 'react';
import type { Session } from './session.js';

/** Ephemeral channel access for board tools (M1-07); null until a session exists (tests). */
export interface EphemeralApi {
  /** Stable authenticated identity used to discard the host's echo of our own previews. */
  identityId: string;
  send: Session['sendEphemeral'];
  on: Session['onEphemeral'];
}

export function isRemoteEphemeralSender(
  from: string | undefined,
  identityId: string,
): from is string {
  return from !== undefined && from !== identityId;
}

export const EphemeralContext = createContext<EphemeralApi | null>(null);
