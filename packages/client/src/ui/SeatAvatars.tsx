import { useMemo } from 'react';
import { useClientStore } from '../store/react.js';
import { avatarHue, initialsOf } from './join-screen.js';
import { seatAvatars } from './seat-avatars.js';

/**
 * UI-TOP-06: one avatar per occupied seat with a connection-quality dot. The names, latency and
 * offline state come from the presence feed UX-06 put on the wire; that feed is host-only, so a
 * player or spectator simply sees no strip (PERM-03: no new data reaches them).
 */
export function SeatAvatars() {
  const campaign = useClientStore((state) => state.campaign);
  const presence = useClientStore((state) => state.presence);
  const seats = useMemo(() => seatAvatars(campaign, presence?.seats ?? null), [campaign, presence]);
  if (seats.length === 0) return null;
  return (
    <ul className="ui-seat-avatars" aria-label="Participants at the table">
      {seats.map((seat) => (
        <li key={seat.id} className="ui-seat-avatar" tabIndex={0} title={seat.detail}>
          <span className="ui-visually-hidden">{seat.summary}</span>
          <span
            className="ui-seat-avatar-badge"
            aria-hidden="true"
            style={{ background: seat.color ?? `hsl(${String(avatarHue(seat.name))} 55% 38%)` }}
          >
            {initialsOf(seat.name)}
          </span>
          {/* The dot states its state in words, and its shape differs per state, so colour is
              never the only carrier of meaning (UIUX.md). */}
          <span
            className="ui-seat-avatar-dot"
            role="img"
            data-tone={seat.tone}
            data-quality={seat.quality}
            aria-label={seat.stateText}
            title={seat.stateText}
          />
          <span className="ui-seat-avatar-popup" aria-hidden="true">
            {seat.detail}
          </span>
        </li>
      ))}
    </ul>
  );
}
