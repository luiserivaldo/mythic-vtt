import { useSyncExternalStore } from 'react';
import { useClientStore } from '../store/react.js';
import { useJoinEnv } from './join-context.js';
import { identitySummary } from './viewer.js';

/** M1-39: every connected browser can tell which identity and seat it is using. */
export function IdentityStatus() {
  const env = useJoinEnv();
  const ready = useClientStore((state) => state.ready);
  const campaign = useClientStore((state) => state.campaign);
  const seatId = useClientStore((state) => state.seatId);
  const isHost = useClientStore((state) => state.isHost);
  const profile = useSyncExternalStore(
    env?.session.subscribe ?? (() => () => undefined),
    env?.session.currentProfile ?? (() => null),
  );
  if (!ready || profile === null) return null;
  const summary = identitySummary({
    displayName: profile.displayName,
    isHost,
    seatId,
    campaign,
  });
  return (
    <p className="ui-identity-status" aria-label="Current identity">
      <strong>{summary.displayName}</strong>
      <span>{summary.roleLabel}</span>
      {summary.seatLabel !== summary.roleLabel && <span>{summary.seatLabel}</span>}
    </p>
  );
}
