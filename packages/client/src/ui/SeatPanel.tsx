import { useState } from 'react';
import { SEAT_TEMPLATES, type Campaign } from '@mythic/shared';
import { newId } from './ids.js';
import {
  seatAssignIntent,
  seatCreateIntent,
  seatPermissionIntent,
  seatReleaseIntent,
  seatRoleIntent,
} from './intent-specs.js';
import { NameForm } from './NameForm.js';
import { SeatInvites } from './SeatInvites.js';
import type { JoinUrl } from './share-panel.js';
import {
  connectedIdentityRows,
  isValidIdentityId,
  isValidLabel,
  PERMISSION_KEYS,
  rosterOptions,
  seatRows,
} from './seat-panel.js';
import { useSubmit } from './submit.js';
import { useClientStore } from '../store/react.js';

interface Props {
  campaign: Campaign;
  presence:
    readonly { seatId: string; connected: boolean; displayName?: string | undefined }[] | null;
  /** M1-11: connected identities without a seat (host only), offered as a dropdown. */
  unseated?: readonly { identityId: string; displayName: string }[] | undefined;
  /** SES-04: the host's player join URLs; the first one carries the per-seat invite links. */
  joinUrls: readonly JoinUrl[];
}

export function SeatPanel({ campaign, presence, unseated, joinUrls }: Props) {
  const roster = rosterOptions(unseated);
  const connected = connectedIdentityRows(campaign, presence, unseated);
  const rows = seatRows(campaign, presence);
  const { send, error } = useSubmit();
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [identity, setIdentity] = useState<Record<string, string>>({});
  const spectators = useClientStore((s) => s.presence?.spectators ?? 0);
  return (
    <section aria-labelledby="ui-seats-h" className="ui-panel">
      <h2 id="ui-seats-h">Participants and permissions</h2>
      <h3>Connected identities</h3>
      {connected.length === 0 ? (
        <p>No players or spectators are connected.</p>
      ) : (
        <ul className="ui-list" aria-label="Connected identities">
          {connected.map((identity) => (
            <li className="ui-row" key={identity.key}>
              <strong>{identity.displayName}</strong>
              <span>{identity.seatLabel}</span>
              <span className="ui-badge">{identity.roleLabel}</span>
            </li>
          ))}
        </ul>
      )}
      {/* UI-JOIN-01: spectators are counted, never listed or named. */}
      <p aria-label="Spectators">Spectators watching: {spectators}</p>
      {archiveId !== null && campaign.seats[archiveId] && (
        <section role="dialog" aria-modal="true" aria-labelledby="archive-title">
          <h3 id="archive-title">Archive {campaign.seats[archiveId].label}?</h3>
          <p>
            This seat can no longer be joined. Its tokens become unassigned; nothing is deleted.
          </p>
          <ul>
            <li>
              {campaign.seats[archiveId].identityId
                ? 'The bound login loses access to this seat.'
                : 'No login is bound to this seat.'}
            </li>
            {Object.values(campaign.scenes).flatMap((scene) =>
              Object.values(scene.entities)
                .filter((entity) => entity.owners.includes(archiveId))
                .map((entity) => (
                  <li key={`${scene.id}/${entity.id}`}>
                    {entity.name || 'Unnamed entity'} in {scene.name}
                    {entity.token?.characterInstanceId
                      ? ' (character link retained, ownership becomes unassigned)'
                      : ''}
                  </li>
                )),
            )}
          </ul>
          <button
            type="button"
            onClick={() => {
              void send({ type: 'seat.archive', payload: { seatId: archiveId } }).then((ok) => {
                if (ok) setArchiveId(null);
              });
            }}
          >
            Confirm archive
          </button>
          <button
            type="button"
            onClick={() => {
              setArchiveId(null);
            }}
          >
            Cancel
          </button>
        </section>
      )}
      {Object.values(campaign.seats).some((seat) => seat.archived) && (
        <details>
          <summary>Archived seats</summary>
          <ul>
            {Object.values(campaign.seats)
              .filter((seat) => seat.archived)
              .map((seat) => (
                <li key={seat.id}>{seat.label} (archived)</li>
              ))}
          </ul>
        </details>
      )}
      <h3>Participants</h3>
      <ul className="ui-list" aria-label="Participants">
        {rows.map((row) => {
          const typed = identity[row.id] ?? '';
          return (
            <li key={row.id} aria-label={`${row.label} participant`}>
              <div className="ui-row">
                <strong>{row.label}</strong>
                <span className="ui-badge">
                  {row.occupied ? (row.connected ? 'Online' : 'Offline') : 'Empty'}
                </span>
                {row.occupantName !== undefined && <span>{row.occupantName}</span>}
                <label>
                  Access role{' '}
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
                <label>
                  <input
                    type="checkbox"
                    checked={row.interactionEnabled}
                    onChange={(e) => {
                      void send({
                        type: 'seat.update',
                        payload: { seatId: row.id, interactionEnabled: e.target.checked },
                      });
                    }}
                  />{' '}
                  Enable Interaction
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setArchiveId(row.id);
                  }}
                >
                  Archive participant
                </button>
                {row.occupied && (
                  <button
                    type="button"
                    onClick={() => {
                      void send(seatReleaseIntent(row.id));
                    }}
                  >
                    Release participant
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
                      <span className="ui-visually-hidden">
                        Connected participant for {row.label}
                      </span>
                      <select
                        value={isValidIdentityId(typed) ? typed : ''}
                        onChange={(e) => {
                          setIdentity({ ...identity, [row.id]: e.target.value });
                        }}
                      >
                        <option value="">Connected participant...</option>
                        {roster.map((o) => (
                          <option key={o.identityId} value={o.identityId}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label>
                    <span className="ui-visually-hidden">
                      Participant identity id for {row.label}
                    </span>
                    <input
                      type="text"
                      placeholder="Participant identity id"
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
      <SeatInvites
        seats={rows.map((row) => ({ id: row.id, label: row.label }))}
        playerUrl={joinUrls[0]?.url}
      />
      <fieldset>
        <legend>Add a participant template</legend>
        <div className="ui-row">
          {SEAT_TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              title={template.description}
              onClick={() => {
                void send(
                  seatCreateIntent(newId(), template.label, template.role, template.permissions),
                );
              }}
            >
              Add {template.label}
            </button>
          ))}
        </div>
        <p>Templates are presets. You can adjust access and permissions after adding one.</p>
      </fieldset>
      <NameForm
        label="Custom participant name"
        submitLabel="Add custom participant"
        validate={isValidLabel}
        onSubmit={(t) => send(seatCreateIntent(newId(), t, 'player'))}
      />
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
