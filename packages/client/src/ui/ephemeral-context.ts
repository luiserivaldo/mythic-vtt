import { createContext } from 'react';
import type { Session } from './session.js';

/** Ephemeral channel access for board tools (M1-07); null until a session exists (tests). */
export interface EphemeralApi {
  identityId: string;
  send: Session['sendEphemeral'];
  on: Session['onEphemeral'];
}

export const EphemeralContext = createContext<EphemeralApi | null>(null);

/** M1-33: the host echoes ephemerals back to their sender; only other senders are remote. */
export function isRemoteEphemeralSender(
  from: string | undefined,
  identityId: string,
): from is string {
  return from !== undefined && from !== identityId;
}
