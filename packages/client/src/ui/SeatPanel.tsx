import { useState } from 'react';
import type { Campaign, SeatTemplateId } from '@mythic/shared';
import { newId } from './ids.js';
import {
  seatAssignIntent,
  seatCreateIntent,
  seatPermissionIntent,
  seatReleaseIntent,
  seatRoleIntent,
} from './intent-specs.js';
import { SeatInvites } from './SeatInvites.js';
import type { JoinUrl } from './share-panel.js';
import {
  archiveImpact,
  connectedIdentityRows,
  isValidIdentityId,
  newSeatFields,
  rosterOptions,
  SEAT_TOGGLES,
  seatRows,
  seatTemplateOptions,
  type SeatRow,
} from './seat-panel.js';
import { useSubmit } from './submit.js';
import { useClientStore } from '../store/react.js';

interface Props {
  campaign: Campaign;
  presence:
    | readonly {
        seatId: string;
        connected: boolean;
        displayName?: string | undefined;
        color?: string | undefined;
      }[]
    | null;
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
  const templates = seatTemplateOptions();
  const [templateId, setTemplateId] = useState<SeatTemplateId>('player');
  const [newName, setNewName] = useState('');
  const impact = archiveId === null ? null : archiveImpact(campaign, archiveId);
  const spectators = useClientStore((s) => s.presence?.spectators ?? 0);
  return (
    <section aria-labelledby="ui-seats-h" className="ui-panel">
      <h2 id="ui-seats-h">Seats</h2>
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
      {impact !== null && archiveId !== null && (
        <section role="dialog" aria-modal="true" aria-labelledby="archive-title">
          <h3 id="archive-title">Archive {impact.label}?</h3>
          <p>
            This seat can no longer be joined. Its tokens become unassigned; nothing is deleted.
          </p>
          <ul>
            <li>
              {impact.loginBound
                ? 'The bound login loses access to this seat.'
                : 'No login is bound to this seat.'}
            </li>
            {impact.entities.map((entity) => (
              <li key={entity.key}>{entity.text}</li>
            ))}
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
      <h3>Seats</h3>
      {rows.length === 0 ? (
        <p>No seats yet. Add one below.</p>
      ) : (
        <ul className="ui-list ui-seat-list" aria-label="Seats">
          {rows.map((row) => (
            <li key={row.id} aria-label={`${row.label} seat`}>
              {/* UI-SEAT-01: expanding a seat opens that seat's own settings. */}
              <details>
                <summary className="ui-row">
                  <SeatBadgeView row={row} />
                  <strong>{row.label}</strong>
                  <span className="ui-badge">{row.roleLabel}</span>
                  <span className="ui-badge">
                    {row.occupied ? (row.connected ? 'Online' : 'Offline') : 'Empty'}
                  </span>
                  {row.occupantName !== undefined && <span>{row.occupantName}</span>}
                </summary>
                <div role="group" aria-label={`Settings for ${row.label}`} className="ui-panel">
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
                  {/* UI-SEAT-02: per-seat toggles; no lasting-AoE toggle. UI-SEAT-05 below. */}
                  <fieldset>
                    <legend>Permissions for {row.label}</legend>
                    {SEAT_TOGGLES.map((toggle) => (
                      <label key={toggle.key}>
                        <input
                          type="checkbox"
                          checked={row.permissions[toggle.key]}
                          onChange={(e) => {
                            void send(seatPermissionIntent(row.id, toggle.key, e.target.checked));
                          }}
                        />{' '}
                        {toggle.label}
                      </label>
                    ))}
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
                  </fieldset>
                  {row.occupied ? (
                    <button
                      type="button"
                      onClick={() => {
                        void send(seatReleaseIntent(row.id));
                      }}
                    >
                      Release seat
                    </button>
                  ) : (
                    <form
                      className="ui-row"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void send(seatAssignIntent(row.id, identity[row.id] ?? ''));
                      }}
                    >
                      {roster.length > 0 && (
                        <label>
                          <span className="ui-visually-hidden">
                            Connected participant for {row.label}
                          </span>
                          <select
                            value={
                              isValidIdentityId(identity[row.id] ?? '') ? identity[row.id] : ''
                            }
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
                          value={identity[row.id] ?? ''}
                          onChange={(e) => {
                            setIdentity({ ...identity, [row.id]: e.target.value });
                          }}
                        />
                      </label>
                      <button type="submit" disabled={!isValidIdentityId(identity[row.id] ?? '')}>
                        Assign
                      </button>
                    </form>
                  )}
                  {/* UI-SEAT-03: archive, never delete; the warning lists what is affected. */}
                  <button
                    type="button"
                    onClick={() => {
                      setArchiveId(row.id);
                    }}
                  >
                    Archive seat
                  </button>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
      {/* UI-SEAT-04 (M4-05): copy a seat's invite link. */}
      <SeatInvites
        seats={rows.map((row) => ({ id: row.id, label: row.label }))}
        playerUrl={joinUrls[0]?.url}
      />
      <form
        aria-label="Add a seat"
        onSubmit={(e) => {
          e.preventDefault();
          const fields = newSeatFields(templateId, newName);
          if (!fields) return;
          void send(seatCreateIntent(newId(), fields.label, fields.role, fields.permissions)).then(
            (ok) => {
              if (ok) setNewName('');
            },
          );
        }}
      >
        <h3>Add a seat</h3>
        <div className="ui-row">
          <label>
            Seat template{' '}
            <select
              value={templateId}
              onChange={(e) => {
                const picked = templates.find((t) => t.id === e.target.value);
                if (picked) setTemplateId(picked.id);
              }}
            >
              {templates.map((template) => (
                <option key={template.id} value={template.id} title={template.description}>
                  {template.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Seat name{' '}
            <input
              type="text"
              placeholder={templates.find((t) => t.id === templateId)?.label}
              value={newName}
              maxLength={120}
              onChange={(e) => {
                setNewName(e.target.value);
              }}
            />
          </label>
          <button type="submit" disabled={newSeatFields(templateId, newName) === null}>
            Add seat
          </button>
        </div>
        <p>A template sets the seat's starting permissions. Adjust each seat after adding it.</p>
      </form>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

function SeatBadgeView({ row }: { row: SeatRow }) {
  return row.badge.kind === 'image' ? (
    <img className="ui-seat-avatar-badge" src={row.badge.src} alt="" />
  ) : (
    <span
      className="ui-seat-avatar-badge"
      aria-hidden="true"
      style={{ background: row.color }}
      data-kind={row.badge.kind}
    >
      {row.badge.text}
    </span>
  );
}
