import { useEffect, useId, useRef, useState } from 'react';
import { useClientStore } from '../store/react.js';
import {
  canInvite,
  INTERNET_PLAY_GUIDE_URL,
  inviteSeats,
  type InviteSeat,
} from './invite-popover.js';
import { issueSeatInvite, listSeatInvites, seatInviteUrl } from './seat-invites.js';
import { copyJoinUrl, copyText, joinUrlsFromNotices, playerVisibleUrl } from './share-panel.js';
import type { JoinUrl } from './share-panel.js';
import { viewerRole } from './viewer.js';

interface PopoverProps {
  joinUrls: readonly JoinUrl[];
  seats: readonly InviteSeat[];
  /** Refreshes which seats already have a link each time the popover opens. */
  open?: boolean;
}

/**
 * UI-TOP-07 / UI-SEAT-04: the join links, the internet-play guide, the relay placeholder and a
 * per-seat copy. It only presents the existing links (M1-38 join URLs, M4-05 seat invites): the
 * host makes them, and a seat token lives in this component's memory and the clipboard only.
 */
export function InvitePopover({ joinUrls, seats, open = true }: PopoverProps) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<readonly string[]>([]);
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const playerUrl = joinUrls[0]?.url;

  useEffect(() => {
    if (!open) return;
    let current = true;
    void listSeatInvites().then(
      (seatIds) => {
        if (current) setLive(seatIds);
      },
      () => {
        // Only decides the "previous link stopped working" wording; the host re-checks every call.
      },
    );
    return () => {
      current = false;
    };
  }, [open]);

  const copyJoin = (entry: JoinUrl) => {
    void copyJoinUrl(entry.url, navigator.clipboard).then(
      () => {
        setStatus(`Copied the ${entry.kind === 'lan' ? 'LAN' : 'public'} link.`);
      },
      () => {
        setStatus('Could not copy the link.');
      },
    );
  };

  // SES-04: the host never re-sends a token, so a seat whose link this page did not issue gets a
  // new one, exactly as the seat panel's Copy link does, and the status says the old one died.
  const copySeat = async (seat: InviteSeat, url: string) => {
    setBusy(true);
    try {
      const held = tokens[seat.id];
      const replaced = held === undefined && live.includes(seat.id);
      const token = held ?? (await issueSeatInvite(seat.id));
      setTokens((known) => ({ ...known, [seat.id]: token }));
      setLive((known) => (known.includes(seat.id) ? known : [...known, seat.id]));
      await copyText(seatInviteUrl(url, seat.id, token), navigator.clipboard);
      setStatus(
        replaced
          ? `New link copied. The previous link for ${seat.label} stopped working.`
          : `Copied the invite for ${seat.label}.`,
      );
    } catch {
      setStatus('Could not copy the invite.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2 className="ui-invite-title">Invite players</h2>
      <section aria-label="Join links">
        <h3>Join link</h3>
        {joinUrls.length === 0 ? (
          <p className="ui-invite-note">
            No join link yet. Start the host with <code>--lan</code> for players on your network.
          </p>
        ) : (
          <ul className="ui-list">
            {joinUrls.map((entry, index) => (
              <li className="ui-share-row" key={`${entry.kind}-${String(index)}`}>
                <span className="ui-badge">{entry.kind === 'lan' ? 'LAN' : 'Public'}</span>
                <span className="ui-invite-url">{playerVisibleUrl(entry.url)}</span>
                <button
                  type="button"
                  onClick={() => {
                    copyJoin(entry);
                  }}
                >
                  Copy
                </button>
              </li>
            ))}
          </ul>
        )}
        <a href={INTERNET_PLAY_GUIDE_URL} target="_blank" rel="noreferrer">
          Playing over the internet? Read the guide
        </a>
      </section>
      {playerUrl !== undefined && seats.length > 0 && (
        <section aria-label="Seat invites">
          <h3>Invite to a seat</h3>
          <p className="ui-invite-note">Anyone holding a seat link can take that seat.</p>
          <ul className="ui-list">
            {seats.map((seat) => (
              <li className="ui-row" key={seat.id} aria-label={`Seat ${seat.label}`}>
                <strong className="ui-invite-url">{seat.label}</strong>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void copySeat(seat, playerUrl);
                  }}
                >
                  Copy invite for this seat
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {/* CLOUD-02: a later-milestone service; shown greyed and labelled, with no behaviour. */}
      <section className="ui-invite-card" aria-label="Mythic Cloud relay" aria-disabled="true">
        <div className="ui-row">
          <strong>Mythic Cloud relay</strong>
          <span className="ui-badge">Coming soon</span>
        </div>
        <p className="ui-invite-note">A public link in one click. No port forwarding.</p>
        <button type="button" disabled>
          Get a public link
        </button>
      </section>
      {status !== null && <p role="status">{status}</p>}
    </>
  );
}

/** UI-TOP-07: the top bar's Invite button. It renders nothing for anyone but the DM. */
export function InviteButton() {
  const campaign = useClientStore((s) => s.campaign);
  const isHost = useClientStore((s) => s.isHost);
  const seatId = useClientStore((s) => s.seatId);
  const notices = useClientStore((s) => s.notices);
  const [open, setOpen] = useState(false);
  // Mounted on first open, then only hidden, so a seat link copied earlier is copied again as is
  // instead of being rotated by a second Copy after the popover was closed.
  const [opened, setOpened] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  const allowed = canInvite(viewerRole({ campaign, isHost, seatId }));

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  if (!allowed) return null;
  return (
    <div className="ui-invite" ref={root}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={opened ? popoverId : undefined}
        onClick={() => {
          setOpened(true);
          setOpen(!open);
        }}
      >
        Invite
      </button>
      {opened && (
        <div
          id={popoverId}
          className="ui-invite-popover"
          role="dialog"
          aria-label="Invite players"
          hidden={!open}
        >
          <InvitePopover
            joinUrls={joinUrlsFromNotices(notices)}
            seats={inviteSeats(campaign)}
            open={open}
          />
        </div>
      )}
    </div>
  );
}
