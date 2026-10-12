import { useEffect, useState } from 'react';
import { copyText } from './share-panel.js';
import {
  inviteWarning,
  issueSeatInvite,
  listSeatInvites,
  revokeSeatInvite,
  seatInviteUrl,
} from './seat-invites.js';

interface SeatOption {
  id: string;
  label: string;
}

interface Props {
  /** Every seat, empty or occupied: the DM can hand out a link before the player arrives. */
  seats: readonly SeatOption[];
  /** The join URL players use, or undefined when the host reported none. */
  playerUrl: string | undefined;
}

/**
 * SES-04: one row per seat with Copy link, Regenerate and Revoke. The host never broadcasts a
 * token, so a link this page did not issue cannot be shown again — Copy issues one instead and
 * says what that did to the previous link.
 */
export function SeatInvites({ seats, playerUrl }: Props) {
  const [live, setLive] = useState<readonly string[]>([]);
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void listSeatInvites().then(
      (seatIds) => {
        if (current) setLive(seatIds);
      },
      () => {
        // The host re-checks every request; a failed lookup only hides which seats already have a link.
      },
    );
    return () => {
      current = false;
    };
  }, []);

  const run = async (seatId: string, failure: string, action: () => Promise<string>) => {
    setBusy(seatId);
    try {
      setStatus(await action());
    } catch {
      setStatus(failure);
    } finally {
      setBusy(null);
    }
  };

  const issue = async (seatId: string): Promise<string> => {
    const token = await issueSeatInvite(seatId);
    setTokens((held) => ({ ...held, [seatId]: token }));
    setLive((known) => (known.includes(seatId) ? known : [...known, seatId]));
    return token;
  };

  const copy = (seat: SeatOption) => {
    if (playerUrl === undefined) return;
    void run(seat.id, 'Could not copy the invite link.', async () => {
      const held = tokens[seat.id];
      const replaced = held === undefined && live.includes(seat.id);
      const token = held ?? (await issue(seat.id));
      await copyText(seatInviteUrl(playerUrl, seat.id, token), navigator.clipboard);
      return replaced
        ? `New link ready. The previous link for ${seat.label} stopped working.`
        : `Copied the invite link for ${seat.label}.`;
    });
  };

  const regenerate = (seat: SeatOption) => {
    if (playerUrl === undefined) return;
    if (!window.confirm(inviteWarning(seat.label))) return;
    void run(seat.id, 'Could not change the invite link.', async () => {
      await issue(seat.id);
      return `New link ready. The previous link for ${seat.label} stopped working.`;
    });
  };

  const revoke = (seat: SeatOption) => {
    void run(seat.id, 'Could not change the invite link.', async () => {
      await revokeSeatInvite(seat.id);
      setTokens((held) =>
        Object.fromEntries(Object.entries(held).filter(([id]) => id !== seat.id)),
      );
      setLive((known) => known.filter((id) => id !== seat.id));
      return 'Invite link revoked.';
    });
  };

  return (
    <section aria-label="Invite links">
      <h3>Invite links</h3>
      {playerUrl === undefined ? (
        <p>No player join URL is available. Start the host in LAN mode or set MYTHIC_PUBLIC_URL.</p>
      ) : (
        <>
          <p>Send a link to the person you want in that seat. Anyone holding it can take it.</p>
          <ul className="ui-list" aria-label="Seat invite links">
            {seats.map((seat) => {
              const held = tokens[seat.id];
              const url = held === undefined ? null : seatInviteUrl(playerUrl, seat.id, held);
              const active = url !== null || live.includes(seat.id);
              return (
                <li key={seat.id} aria-label={`Invite link for ${seat.label}`}>
                  <div className="ui-row">
                    <strong>{seat.label}</strong>
                    <span className="ui-badge">{active ? 'Link active' : 'No link'}</span>
                    {url !== null && (
                      <a href={url} target="_blank" rel="noreferrer">
                        {url}
                      </a>
                    )}
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => {
                        copy(seat);
                      }}
                    >
                      Copy link
                    </button>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => {
                        regenerate(seat);
                      }}
                    >
                      Regenerate
                    </button>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => {
                        revoke(seat);
                      }}
                    >
                      Revoke
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {status !== null && <p role="status">{status}</p>}
        </>
      )}
    </section>
  );
}
