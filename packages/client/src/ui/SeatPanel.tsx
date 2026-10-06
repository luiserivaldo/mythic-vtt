import { useState } from 'react';
import type { Campaign } from '@mythic/shared';
import { newId } from './ids.js';
import {
  seatAssignIntent,
  seatCreateIntent,
  seatPermissionIntent,
  seatReleaseIntent,
  seatRoleIntent,
} from './intent-specs.js';
import { NameForm } from './NameForm.js';
import {
  isValidIdentityId,
  isValidLabel,
  PERMISSION_KEYS,
  rosterOptions,
  seatRows,
} from './seat-panel.js';
import { useSubmit } from './submit.js';

interface Props {
  campaign: Campaign;
  presence:
    readonly { seatId: string; connected: boolean; displayName?: string | undefined }[] | null;
  /** M1-11: connected identities without a seat (host only), offered as a dropdown. */
  unseated?: readonly { identityId: string; displayName: string }[] | undefined;
}

export function SeatPanel({ campaign, presence, unseated }: Props) {
  const roster = rosterOptions(unseated);
  const { send, error } = useSubmit();
  const [identity, setIdentity] = useState<Record<string, string>>({});
  return (
    <section aria-labelledby="ui-seats-h" className="ui-panel">
      <h2 id="ui-seats-h">Seats and permissions</h2>
      <ul className="ui-list">
        {seatRows(campaign, presence).map((row) => {
          const typed = identity[row.id] ?? '';
          return (
            <li key={row.id}>
              <div className="ui-row">
                <strong>{row.label}</strong>
                <span className="ui-badge">
                  {row.occupied ? (row.connected ? 'Online' : 'Offline') : 'Empty'}
                </span>
                {row.occupantName !== undefined && <span>{row.occupantName}</span>}
                <label>
                  Role{' '}
                  <select
                    value={row.role}
                    onChange={(e) => {
                      void send(
                        seatRoleIntent(row.id, e.target.value === 'codm' ? 'codm' : 'player'),
                      );
                    }}
                  >
                    <option value="player">Player</option>
                    <option value="codm">Co-DM</option>
                  </select>
                </label>
                {row.occupied && (
                  <button
                    type="button"
                    onClick={() => {
                      void send(seatReleaseIntent(row.id));
                    }}
                  >
                    Release seat
                  </button>
                )}
              </div>
              {!row.occupied && (
                <form
                  className="ui-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send(seatAssignIntent(row.id, typed));
                  }}
                >
                  {roster.length > 0 && (
                    <label>
                      <span className="ui-visually-hidden">Connected player for {row.label}</span>
                      <select
                        value={isValidIdentityId(typed) ? typed : ''}
                        onChange={(e) => {
                          setIdentity({ ...identity, [row.id]: e.target.value });
                        }}
                      >
                        <option value="">Connected player...</option>
                        {roster.map((o) => (
                          <option key={o.identityId} value={o.identityId}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label>
                    <span className="ui-visually-hidden">Player identity id for {row.label}</span>
                    <input
                      type="text"
                      placeholder="Player identity id"
                      value={typed}
                      onChange={(e) => {
                        setIdentity({ ...identity, [row.id]: e.target.value });
                      }}
                    />
                  </label>
                  <button type="submit" disabled={!isValidIdentityId(typed)}>
                    Assign
                  </button>
                </form>
              )}
              <fieldset>
                <legend>Permissions for {row.label}</legend>
                {PERMISSION_KEYS.map((key) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={row.permissions[key]}
                      onChange={(e) => {
                        void send(seatPermissionIntent(row.id, key, e.target.checked));
                      }}
                    />{' '}
                    {key}
                  </label>
                ))}
              </fieldset>
            </li>
          );
        })}
      </ul>
      <NameForm
        label="New seat name"
        submitLabel="Add seat"
        validate={isValidLabel}
        onSubmit={(t) => send(seatCreateIntent(newId(), t, 'player'))}
      />
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
