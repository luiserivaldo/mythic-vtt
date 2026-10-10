import { IdentityTransfer } from './IdentityTransfer.js';
import { useEffect, useState, useSyncExternalStore, type SyntheticEvent } from 'react';
import { useClientStore } from '../store/react.js';
import {
  AVATAR_PIXELS,
  DISPLAY_NAME_MAX,
  avatarHue,
  cleanDisplayName,
  defaultSeat,
  fitSize,
  initialsOf,
  isValidAvatar,
  joinStep,
  saveProfile,
  seatChoices,
  validSelection,
  withoutSpectator,
  type Profile,
} from './join-screen.js';
import { useJoinEnv, type JoinEnv } from './join-context.js';
import './join-screen.css';

/** SES-01: name, optional avatar and seat choice, shown to every visitor except the host. */
export function JoinScreen() {
  const env = useJoinEnv();
  return env ? <JoinFlow env={env} /> : null;
}

function JoinFlow({ env }: { env: JoinEnv }) {
  const { session, storage, identityId } = env;
  const started = useSyncExternalStore(session.subscribe, session.started);
  const ready = useClientStore((s) => s.ready);
  const seatId = useClientStore((s) => s.seatId);
  const [profile, setProfile] = useState<Profile | null>(env.initialProfile);
  const [editingName, setEditingName] = useState(false);

  const step = joinStep({
    hostVisitor: env.hostVisitor,
    started,
    editingName,
    ready,
    seatId,
    spectator: profile?.spectator === true,
  });

  const update = (next: Profile) => {
    saveProfile(storage, next);
    setProfile(next);
  };

  // SES-06: remember the seat this identity ends up in, so a later visit can mark it.
  useEffect(() => {
    if (seatId === null || !profile || env.hostVisitor) return;
    if (profile.lastSeatId === seatId && profile.spectator !== true) return;
    update({ ...withoutSpectator(profile), lastSeatId: seatId });
  }, [seatId, profile?.lastSeatId, profile?.spectator]);

  if (step === 'name') {
    return (
      <NameStep
        initial={profile}
        onSubmit={(p) => {
          const next: Profile = {
            ...p,
            ...(profile?.lastSeatId ? { lastSeatId: profile.lastSeatId } : {}),
          };
          update(next);
          setEditingName(false);
          session.start(next);
        }}
      />
    );
  }
  if (step === 'connecting') {
    return (
      <Card title="Joining the table">
        <p>Connecting to the host...</p>
      </Card>
    );
  }
  if (step === 'seat' && profile) {
    return (
      <SeatStep
        identityId={identityId}
        profile={profile}
        onSeat={(id) => {
          session.joinSeat(id);
        }}
        onSpectate={() => {
          update({ ...profile, spectator: true });
        }}
        onChangeName={() => {
          session.stop();
          setEditingName(true);
        }}
      />
    );
  }
  if (!env.hostVisitor && started && ready && seatId === null && profile) {
    // A spectator by choice can still ask for a seat later.
    return (
      <button
        type="button"
        className="join-reopen"
        onClick={() => {
          update(withoutSpectator(profile));
        }}
      >
        Spectating: choose a participant slot
      </button>
    );
  }
  return null;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="join-backdrop">
      <section className="join-card" role="dialog" aria-modal="true" aria-labelledby="join-h">
        <h2 id="join-h">{title}</h2>
        {children}
      </section>
    </div>
  );
}

export function AvatarBadge({ name, avatar }: { name: string; avatar?: string | undefined }) {
  if (avatar) return <img className="join-avatar" src={avatar} alt="" />;
  return (
    <span
      className="join-avatar"
      aria-hidden="true"
      style={{ background: `hsl(${String(avatarHue(name))} 55% 38%)` }}
    >
      {initialsOf(name)}
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
  initial,
  onSubmit,
}: {
  initial: Profile | null;
  onSubmit: (p: Profile) => void;
}) {
  const [name, setName] = useState(initial?.displayName ?? '');
  const [avatar, setAvatar] = useState<string | undefined>(initial?.avatar);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const clean = cleanDisplayName(name);

  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    if (clean === null) return;
    onSubmit({ displayName: clean, ...(avatar !== undefined ? { avatar } : {}) });
  };

  return (
    <Card title="Join the table">
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
        <div className="join-avatar-row">
          <AvatarBadge name={clean ?? name} avatar={avatar} />
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
        <button type="submit" disabled={clean === null}>
          Continue
        </button>
      </form>
      <IdentityTransfer />
    </Card>
  );
}

function SeatStep({
  identityId,
  profile,
  onSeat,
  onSpectate,
  onChangeName,
}: {
  identityId: string;
  profile: Profile;
  onSeat: (seatId: string) => void;
  onSpectate: () => void;
  onChangeName: () => void;
}) {
  const campaign = useClientStore((s) => s.campaign);
  const choices = campaign ? seatChoices(campaign, identityId, profile.lastSeatId) : [];
  const [selected, setSelected] = useState<string | null>(() => defaultSeat(choices));
  const [attempt, setAttempt] = useState<string | null>(null);
  const chosen = validSelection(choices, selected);
  const lost = attempt !== null && choices.find((c) => c.id === attempt)?.state === 'taken';

  return (
    <Card title={`Welcome, ${profile.displayName}`}>
      <div className="join-who">
        <AvatarBadge name={profile.displayName} avatar={profile.avatar} />
        <button type="button" className="join-link" onClick={onChangeName}>
          Change name or avatar
        </button>
      </div>
      <form
        className="join-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (chosen === null) return;
          setAttempt(chosen);
          onSeat(chosen);
        }}
      >
        <fieldset>
          <legend>Choose a participant slot</legend>
          {choices.length === 0 && (
            <p>The DM has not created any participant slots yet. You can watch as a spectator.</p>
          )}
          {choices.map((c) => (
            <label key={c.id} className={c.disabled ? 'join-seat join-seat-taken' : 'join-seat'}>
              <input
                type="radio"
                name="seat"
                value={c.id}
                checked={chosen === c.id}
                disabled={c.disabled}
                onChange={() => {
                  setSelected(c.id);
                }}
              />
              <span>
                {c.label} <small>({c.roleLabel})</small>
              </span>
              {c.disabled && <span className="join-badge">Taken</span>}
              {c.previous && !c.disabled && <span className="join-badge">Your slot</span>}
              {c.previous && c.disabled && (
                <span className="join-badge">Your previous slot, taken</span>
              )}
            </label>
          ))}
        </fieldset>
        {lost && <p role="alert">That slot was just taken. Please pick another.</p>}
        <div className="join-actions">
          <button type="submit" disabled={chosen === null}>
            Join participant slot
          </button>
          <button type="button" onClick={onSpectate}>
            Join as spectator
          </button>
        </div>
      </form>
    </Card>
  );
}
