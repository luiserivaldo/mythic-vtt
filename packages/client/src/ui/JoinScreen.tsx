import { IdentityTransfer } from './IdentityTransfer.js';
import { useEffect, useState, useSyncExternalStore, type SyntheticEvent } from 'react';
import { useClientStore } from '../store/react.js';
import type { JoinPayload } from '@mythic/protocol';
import {
  AVATAR_PIXELS,
  DISPLAY_NAME_MAX,
  DEFAULT_PLAYER_COLOR,
  avatarHue,
  cleanDisplayName,
  fitSize,
  initialsOf,
  isValidAvatar,
  joinImageUrl,
  joinSeatRows,
  joinView,
  parseJoinPayload,
  saveProfile,
  withoutSpectator,
  type JoinIcon,
  type JoinRequest,
  type Profile,
} from './join-screen.js';
import { useJoinEnv, type JoinEnv } from './join-context.js';
import './join-screen.css';

const POLL_MS = 3000;

/**
 * UI-JOIN-01 (MV-248): opening a join link shows the table before any socket opens: the DM, the
 * campaign branding and the seat list from `GET /api/join`, a Claim button per seat and the two
 * Join As choices. Only a claim or a temporary seat asks for a name. Shown to every visitor except
 * the host.
 */
export function JoinScreen() {
  const env = useJoinEnv();
  return env && !env.readOnlyVisitor ? <JoinFlow env={env} /> : null;
}

interface Pending {
  request: JoinRequest;
  /** `joinRefusals.count` when the request went out; null until it is sent. */
  sentAt: number | null;
}

function JoinFlow({ env }: { env: JoinEnv }) {
  const { session, storage } = env;
  const started = useSyncExternalStore(session.subscribe, session.started);
  const ready = useClientStore((s) => s.ready);
  const seatId = useClientStore((s) => s.seatId);
  const campaign = useClientStore((s) => s.campaign);
  const notices = useClientStore((s) => s.notices);
  const refusals = useClientStore((s) => s.joinRefusals);
  const [profile, setProfile] = useState<Profile | null>(env.initialProfile);
  const [payload, setPayload] = useState<JoinPayload | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [naming, setNaming] = useState<JoinRequest | null>(
    env.returning ? { kind: 'returning' } : null,
  );
  const [pending, setPending] = useState<Pending | null>(null);
  const [anonymous, setAnonymous] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  const noScene =
    started &&
    ready &&
    campaign?.activeSceneId === null &&
    (seatId === null || campaign.seats[seatId]?.role !== 'codm') &&
    (seatId === null || notices.some((n) => n.message.startsWith('No active scene.')));
  const view = joinView({
    hostVisitor: env.hostVisitor,
    started,
    ready,
    seatId,
    naming,
    pending: pending?.request ?? null,
    watching: anonymous || profile?.spectator === true,
    // An old or unreachable host gives no payload: still offer the choices; the host decides.
    sceneActive: payload?.sceneActive ?? (unreachable ? true : null),
    noScene,
  });
  const showsTable = view === 'pick' || view === 'waiting' || view === 'loading';

  const update = (next: Profile) => {
    saveProfile(storage, next);
    setProfile(next);
  };

  // The seat list and scene state change while the visitor looks at them; poll gently while shown.
  useEffect(() => {
    if (!showsTable || env.hostVisitor) return;
    let cancelled = false;
    const load = () => {
      fetch('/api/join', { cache: 'no-store' })
        .then(async (res) => (res.ok ? parseJoinPayload(await res.json()) : undefined))
        .then((next) => {
          if (cancelled || next === undefined) return; // rate-limited: keep the last view
          if (next) setPayload(next);
          setUnreachable(next === null);
        })
        .catch(() => {
          if (!cancelled) setUnreachable(true);
        });
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [showsTable, env.hostVisitor]);

  // Send the request once this connection is ready; the host answers with a seat or a refusal.
  useEffect(() => {
    if (!pending || !started || !ready) return;
    const { request } = pending;
    if (pending.sentAt === null) {
      if (request.kind === 'claim') session.join({ seatId: request.seatId });
      else if (request.kind === 'temporary')
        session.join({ as: 'temporary', label: profile?.displayName ?? 'Player' });
      else if (request.kind === 'spectator') session.join({ as: 'spectator' });
      if (request.kind === 'spectator') setAnonymous(true);
      if (request.kind === 'spectator' || request.kind === 'returning') setPending(null);
      else setPending({ request, sentAt: refusals.count });
      return;
    }
    if (seatId !== null) setPending(null);
    else if (refusals.count > pending.sentAt) {
      setPending(null);
      setRefused(
        refusals.message.startsWith('No active scene')
          ? refusals.message
          : request.kind === 'claim'
            ? 'That seat was just claimed. Pick another.'
            : 'A temporary seat could not be made. Ask the DM, or join as a spectator.',
      );
    }
  }, [pending, started, ready, seatId, refusals]);

  // SES-06: remember the seat this identity ends up in, so a later visit can mark it.
  useEffect(() => {
    if (seatId === null || !profile || env.hostVisitor) return;
    if (profile.lastSeatId === seatId && profile.spectator !== true) return;
    update({ ...withoutSpectator(profile), lastSeatId: seatId });
  }, [seatId, profile?.lastSeatId, profile?.spectator]);

  /** Every choice opens a fresh connection, so `hello` carries exactly what that choice allows. */
  const connect = (request: JoinRequest, as: Pick<Profile, 'displayName' | 'avatar' | 'color'>) => {
    setRefused(null);
    setAnonymous(false);
    setPending({ request, sentAt: null });
    session.start(as);
  };

  if (view === 'done') return null;
  if (view === 'name' && naming) {
    return (
      <NameStep
        request={naming}
        seatLabel={
          naming.kind === 'claim'
            ? payload?.seats.find((seat) => seat.seatId === naming.seatId)?.label
            : undefined
        }
        initial={profile}
        onBack={() => {
          setNaming(null);
        }}
        onSubmit={(p) => {
          const next: Profile = {
            ...(profile ? withoutSpectator(profile) : {}),
            ...p,
          };
          update(next);
          setNaming(null);
          connect(naming, next);
        }}
      />
    );
  }
  if (view === 'connecting') {
    return (
      <Card title="Joining the table">
        <p>Connecting to the host...</p>
      </Card>
    );
  }
  if (view === 'watching' && profile?.spectator === true && !anonymous) {
    // A remembered unseated visitor: connected under their name, so the DM can seat them.
    return (
      <button
        type="button"
        className="join-reopen"
        onClick={() => {
          update(withoutSpectator(profile));
        }}
      >
        Watching: choose a seat
      </button>
    );
  }
  if (view === 'watching') {
    return (
      <button
        type="button"
        className="join-reopen"
        onClick={() => {
          setAnonymous(false);
        }}
      >
        Watching: choose a seat
      </button>
    );
  }
  return (
    <Card title="Join the table" table={payload}>
      {view === 'loading' && <p>Loading the table...</p>}
      {view === 'waiting' && (
        <p role="alert">No active scene. Ask the DM to activate a scene before joining.</p>
      )}
      {view === 'pick' && (
        <TableChoices
          payload={payload}
          lastSeatId={profile?.lastSeatId}
          refused={refused}
          onClaim={(id) => {
            setNaming({ kind: 'claim', seatId: id });
          }}
          onTemporary={() => {
            setNaming({ kind: 'temporary' });
          }}
          onSpectate={() => {
            // Spectators carry no visual credentials: no name, avatar or colour is sent.
            connect({ kind: 'spectator' }, { displayName: 'Spectator' });
          }}
        />
      )}
      <IdentityTransfer />
    </Card>
  );
}

function Card({
  title,
  table,
  children,
}: {
  title: string;
  table?: JoinPayload | null;
  children: React.ReactNode;
}) {
  return (
    <div className="join-backdrop">
      <section className="join-card" role="dialog" aria-modal="true" aria-labelledby="join-h">
        <h1 className="join-brand">
          Mythic VTT <small>by MythicTomes</small>
        </h1>
        {table && <TableHeader payload={table} />}
        <h2 id="join-h">{title}</h2>
        {children}
      </section>
    </div>
  );
}

/** The DM's public profile and the campaign branding, exactly as the join payload gives them. */
function TableHeader({ payload }: { payload: JoinPayload }) {
  const { campaign, host } = payload;
  return (
    <div className="join-table">
      {campaign.screenshot !== undefined && (
        <img
          className="join-screenshot"
          src={joinImageUrl(campaign.screenshot)}
          alt="Campaign screenshot"
        />
      )}
      <div className="join-who">
        {campaign.icon && <JoinIconBadge icon={campaign.icon} />}
        <p className="join-campaign" aria-label="Campaign">
          {campaign.title || 'Untitled campaign'}
        </p>
      </div>
      <div className="join-who" aria-label="Game Master">
        <AvatarBadge name={host.name} avatar={host.avatar} />
        <span>
          <small>Game Master</small> <strong>{host.name}</strong>
        </span>
      </div>
    </div>
  );
}

function JoinIconBadge({ icon }: { icon: JoinIcon }) {
  return icon.kind === 'image' ? (
    <img className="join-icon" src={joinImageUrl(icon.hash)} alt="" />
  ) : (
    <span className="join-icon" aria-hidden="true">
      {icon.value}
    </span>
  );
}

function TableChoices({
  payload,
  lastSeatId,
  refused,
  onClaim,
  onTemporary,
  onSpectate,
}: {
  payload: JoinPayload | null;
  lastSeatId: string | undefined;
  refused: string | null;
  onClaim: (seatId: string) => void;
  onTemporary: () => void;
  onSpectate: () => void;
}) {
  const rows = payload ? joinSeatRows(payload, lastSeatId) : [];
  return (
    <div className="join-form">
      {refused && <p role="alert">{refused}</p>}
      <h3 id="join-seats-h">Seats</h3>
      {rows.length === 0 ? (
        <p>The DM has not created any seats yet.</p>
      ) : (
        <ul className="join-seats" aria-labelledby="join-seats-h">
          {rows.map((row) => (
            <li
              key={row.seatId}
              className={row.claimed ? 'join-seat join-seat-taken' : 'join-seat'}
            >
              {row.icon && <JoinIconBadge icon={row.icon} />}
              <span className="join-seat-name">
                {row.label} <small>({row.roleLabel})</small>
              </span>
              {row.previous && <span className="join-badge">Your last seat</span>}
              {row.claimed && <span className="join-badge">Claimed</span>}
              <button
                type="button"
                aria-label={`Claim ${row.label}`}
                disabled={!row.claimable}
                onClick={() => {
                  onClaim(row.seatId);
                }}
              >
                Claim
              </button>
            </li>
          ))}
        </ul>
      )}
      <h3>Join as</h3>
      <div className="join-actions">
        <button type="button" onClick={onTemporary}>
          Temporary Player
        </button>
        <button type="button" onClick={onSpectate}>
          Join As Spectator
        </button>
      </div>
    </div>
  );
}

export function AvatarBadge({
  name,
  avatar,
  color,
}: {
  name: string;
  avatar?: string | undefined;
  color?: string | undefined;
}) {
  if (avatar?.startsWith('data:image/')) return <img className="join-avatar" src={avatar} alt="" />;
  return (
    <span
      className="join-avatar"
      aria-hidden="true"
      style={{ background: color ?? `hsl(${String(avatarHue(name))} 55% 38%)` }}
    >
      {avatar || initialsOf(name)}
    </span>
  );
}

/** Resizes a picked image to a small square-bounded data URL; null if it cannot be made small enough. */
async function readAvatar(file: File): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  const { w, h } = fitSize(bitmap.width, bitmap.height, AVATAR_PIXELS);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  for (const [type, quality] of [
    ['image/webp', 0.8],
    ['image/jpeg', 0.7],
    ['image/jpeg', 0.4],
  ] as const) {
    const url = canvas.toDataURL(type, quality);
    if (isValidAvatar(url)) return url;
  }
  return null;
}

function NameStep({
  request,
  seatLabel,
  initial,
  onBack,
  onSubmit,
}: {
  request: JoinRequest;
  seatLabel: string | undefined;
  initial: Profile | null;
  onBack: () => void;
  onSubmit: (p: Profile) => void;
}) {
  const [name, setName] = useState(initial?.displayName ?? '');
  const [color, setColor] = useState(initial?.color ?? DEFAULT_PLAYER_COLOR);
  const [avatar, setAvatar] = useState<string | undefined>(initial?.avatar);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const clean = cleanDisplayName(name);
  // A temporary seat asks for a display name only (UI-JOIN-01); the stored look is kept as is.
  const nameOnly = request.kind === 'temporary';

  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    if (clean === null) return;
    onSubmit(
      nameOnly
        ? {
            displayName: clean,
            ...(initial?.color !== undefined ? { color: initial.color } : {}),
            ...(initial?.avatar !== undefined ? { avatar: initial.avatar } : {}),
          }
        : { displayName: clean, color, ...(avatar !== undefined ? { avatar } : {}) },
    );
  };

  const title =
    request.kind === 'claim'
      ? `Claim ${seatLabel ?? 'seat'}`
      : request.kind === 'temporary'
        ? 'Temporary Player'
        : 'Welcome back';
  return (
    <Card title={title}>
      <form onSubmit={submit} className="join-form">
        <label>
          Display name
          <input
            type="text"
            value={name}
            maxLength={DISPLAY_NAME_MAX}
            autoComplete="nickname"
            autoFocus
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </label>
        {!nameOnly && (
          <>
            <label>
              Your colour
              <input
                type="color"
                value={color}
                onChange={(e) => {
                  setColor(e.target.value);
                }}
              />
            </label>
            <div className="join-avatar-row">
              <AvatarBadge name={clean ?? name} avatar={avatar} color={color} />
              <label>
                Avatar (optional)
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setAvatarError(null);
                    readAvatar(file)
                      .then((url) => {
                        if (url) setAvatar(url);
                        else setAvatarError('That image is too large; try a smaller one.');
                      })
                      .catch(() => {
                        setAvatarError('That file could not be read as an image.');
                      });
                  }}
                />
              </label>
              {avatar !== undefined && (
                <button
                  type="button"
                  onClick={() => {
                    setAvatar(undefined);
                  }}
                >
                  Remove
                </button>
              )}
            </div>
            {avatarError && <p role="alert">{avatarError}</p>}
          </>
        )}
        <div className="join-actions">
          <button type="submit" disabled={clean === null}>
            Continue
          </button>
          {request.kind !== 'returning' && (
            <button type="button" onClick={onBack}>
              Back
            </button>
          )}
        </div>
      </form>
    </Card>
  );
}
