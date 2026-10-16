import { lazy, Suspense, useEffect, useState } from 'react';
import { parseIdentityFile } from '../net/identity-file.js';
import { IDENTITY_STORAGE_KEY } from '../net/identity.js';
import { useClientStore } from '../store/react.js';
import {
  campaignRows,
  fetchCampaignList,
  fetchCampaignThumbnail,
  hostScreenView,
  pickCampaign,
  type HostStep,
  type ListState,
} from './host-screen.js';
import { inviteSeats } from './invite-popover.js';
import { InvitePopover } from './InvitePopover.js';
import type { JoinEnv } from './join-context.js';
import { joinUrlsFromNotices } from './share-panel.js';
import './join-screen.css';

const SeatPanel = lazy(async () => ({ default: (await import('./SeatPanel.js')).SeatPanel }));
/** This browser's SES-02 identity, for the host-only routes; null if storage holds none. */
function storedCredential(env: JoinEnv) {
  try {
    return parseIdentityFile(env.storage.getItem(IDENTITY_STORAGE_KEY) ?? '');
  } catch {
    return null;
  }
}

const formatTime = (ms: number) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(ms);

/**
 * UI-HOST-01 / HOST-03: the DM's screen after "I'm the DM". Pick the campaign, then Invite, seat
 * management (the Seats tab's own panel) and Start game. Every list and thumbnail comes from the
 * host-only routes with this identity (D36), so a visitor the host does not bind sees nothing.
 */
export function HostScreen({ env }: { env: JoinEnv }) {
  const ready = useClientStore((s) => s.ready);
  const fatalError = useClientStore((s) => s.fatalError);
  const campaign = useClientStore((s) => s.campaign);
  const presence = useClientStore((s) => s.presence);
  const notices = useClientStore((s) => s.notices);
  const [list, setList] = useState<ListState>({ kind: 'loading' });
  const [step, setStep] = useState<HostStep>('campaigns');
  const [notice, setNotice] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);

  // Only after `hello`: the DM link binds this identity as host there, never before (D24).
  useEffect(() => {
    if (!ready) return;
    let current = true;
    const credential = storedCredential(env);
    if (!credential) {
      setList({ kind: 'error' });
      return;
    }
    void fetchCampaignList(fetch, credential).then((next) => {
      if (current) setList(next);
    });
    return () => {
      current = false;
    };
  }, [ready]);

  const view = hostScreenView({ fatalError, ready, list, step });
  if (view === 'done') return null;
  return (
    <div className="join-backdrop">
      <section
        className="join-card host-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="host-h"
      >
        <h1 className="join-brand">
          Mythic VTT <small>by MythicTomes</small>
        </h1>
        {view === 'connecting' && (
          <>
            <h2 id="host-h">I'm the DM</h2>
            <p>Connecting to the host...</p>
          </>
        )}
        {view === 'refused' && (
          <>
            <h2 id="host-h">I'm the DM</h2>
            <p role="alert">
              The host did not accept this browser as the DM. Use the DM link the host printed when
              it started; each link works once.
            </p>
          </>
        )}
        {view === 'error' && (
          <>
            <h2 id="host-h">I'm the DM</h2>
            <p role="alert">Could not load the campaigns. Reload the page to try again.</p>
          </>
        )}
        {view === 'campaigns' && list.kind === 'ok' && (
          <>
            <h2 id="host-h">Choose a campaign</h2>
            {notice && <p role="alert">{notice}</p>}
            <ul className="host-campaigns" aria-label="Campaigns">
              {campaignRows(list.list, formatTime).map((row) => (
                <li key={row.id} className="host-campaign">
                  <CampaignThumbnail
                    env={env}
                    id={row.id}
                    name={row.name}
                    show={row.hasThumbnail}
                  />
                  <span className="host-campaign-name">
                    <strong>{row.name}</strong>
                    <small>{row.played}</small>
                  </span>
                  {row.current && <span className="join-badge">Open on this host</span>}
                  <button
                    type="button"
                    aria-label={`Choose ${row.name}`}
                    onClick={() => {
                      const next = pickCampaign(list.list, row.id);
                      setNotice(next.notice);
                      setStep(next.step);
                    }}
                  >
                    Choose
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {view === 'table' && campaign && (
          <>
            <h2 id="host-h">{campaign.name}</h2>
            <div className="join-actions">
              <button
                type="button"
                aria-expanded={inviting}
                onClick={() => {
                  setInviting(!inviting);
                }}
              >
                Invite
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep('campaigns');
                }}
              >
                Back to campaigns
              </button>
            </div>
            {inviting && (
              <section aria-label="Invite players" className="ui-invite-popover host-invite">
                <InvitePopover
                  joinUrls={joinUrlsFromNotices(notices)}
                  seats={inviteSeats(campaign)}
                />
              </section>
            )}
            <Suspense fallback={<p>Loading seats...</p>}>
              <SeatPanel
                campaign={campaign}
                presence={presence?.seats ?? null}
                unseated={presence?.unseated}
                joinUrls={joinUrlsFromNotices(notices)}
              />
            </Suspense>
            <div className="join-actions">
              <button
                type="button"
                onClick={() => {
                  setStep('done');
                }}
              >
                Start game
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/** The thumbnail as a blob URL (the route needs the Authorization header an `<img>` lacks). */
function CampaignThumbnail({
  env,
  id,
  name,
  show,
}: {
  env: JoinEnv;
  id: string;
  name: string;
  show: boolean;
}) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!show) return;
    let url: string | null = null;
    let current = true;
    const credential = storedCredential(env);
    if (!credential) return;
    void fetchCampaignThumbnail(fetch, credential, id).then((blob) => {
      if (!current || !blob) return;
      url = URL.createObjectURL(blob);
      setSrc(url);
    });
    return () => {
      current = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, show]);
  return src ? (
    <img className="host-thumbnail" src={src} alt={`Thumbnail of ${name}`} />
  ) : (
    <span className="host-thumbnail" aria-hidden="true" />
  );
}
