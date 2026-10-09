import { historyGroups } from './history-groups.js';
import { HistoryPage, type HistoryEntry } from '@mythic/shared';
import { useEffect, useState } from 'react';
import { loadOrCreateIdentity } from '../net/identity.js';
import { useClientStore } from '../store/react.js';
import { viewerRole } from './viewer.js';

function HistoryPanel() {
  const campaign = useClientStore((state) => state.campaign);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [before, setBefore] = useState<number>();
  const [seatId, setSeatId] = useState('');
  const [entityId, setEntityId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void load(false, controller.signal);
    return () => {
      controller.abort();
    };
  }, []);
  async function load(older = false, signal?: AbortSignal) {
    setBusy(true);
    setError('');
    try {
      const identity = loadOrCreateIdentity(
        localStorage,
        Date.now(),
        () => crypto.getRandomValues(new Uint8Array(1))[0] ?? 0,
      );
      const query = new URLSearchParams({ limit: '50' });
      if (seatId) query.set('seatId', seatId);
      if (entityId) query.set('entityId', entityId);
      if (older && before !== undefined) query.set('before', String(before));
      const response = await fetch(`/api/history?${query.toString()}`, {
        headers: { Authorization: `Mythic ${identity.identityId}.${identity.identitySecret}` },
        ...(signal ? { signal } : {}),
      });
      if (!response.ok) throw new Error('Could not load history');
      const page = HistoryPage.parse(await response.json());
      if (signal?.aborted) return;
      setEntries((previous) => (older ? [...previous, ...page.entries] : page.entries));
      setBefore(page.before);
    } catch {
      if (!signal?.aborted) setError('Could not load history. Try refreshing.');
    } finally {
      if (!signal?.aborted) setBusy(false);
    }
  }
  return (
    <section aria-label="Action history" className="ui-panel">
      <h2>Action history</h2>
      <label>
        History seat
        <select
          value={seatId}
          disabled={busy}
          onChange={(event) => {
            setSeatId(event.target.value);
            setBefore(undefined);
          }}
        >
          <option value="">All seats</option>
          {Object.values(campaign?.seats ?? {}).map((seat) => (
            <option key={seat.id} value={seat.id}>
              {seat.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        History entity
        <select
          value={entityId}
          disabled={busy}
          onChange={(event) => {
            setEntityId(event.target.value);
            setBefore(undefined);
          }}
        >
          <option value="">All entities</option>
          {Object.values(campaign?.scenes ?? {}).flatMap((scene) =>
            Object.values(scene.entities).map((entity) => (
              <option key={entity.id} value={entity.id}>
                {scene.name}: {entity.name || 'Unnamed entity'}
              </option>
            )),
          )}
        </select>
      </label>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          void load();
        }}
      >
        Refresh history
      </button>
      {error && <p role="alert">{error}</p>}
      {!busy && entries.length === 0 && <p>No visible actions.</p>}
      <ol>
        {historyGroups(entries).map((group, groupIndex) => (
          <li key={groupIndex}>
            <h3>
              {group.round === undefined && group.turn === undefined
                ? 'Before rounds'
                : `Round ${String(group.round ?? '—')}, turn ${String(group.turn ?? '—')}`}
            </h3>
            <ol>
              {group.entries.map((entry) => (
                <li key={`${entry.sessionId}:${String(entry.seq)}`}>
                  <details>
                    <summary>
                      #{entry.seq} {entry.type} —{' '}
                      {entry.seatId ? (campaign?.seats[entry.seatId]?.label ?? 'Seat') : 'DM'}
                      {entry.round !== undefined &&
                        ` · Round ${String(entry.round)}, turn ${String(entry.turn ?? 0)}`}
                    </summary>
                    <ul>
                      {entry.changes.map((change, index) => (
                        <li key={index}>
                          <code>
                            {change.op} /{change.path.join('/')}
                            {change.op !== 'remove' && `: ${JSON.stringify(change.value)}`}
                          </code>
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ol>
      {before !== undefined && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void load(true);
          }}
        >
          Older actions
        </button>
      )}
    </section>
  );
}

export function HistoryTools() {
  const campaign = useClientStore((state) => state.campaign);
  const ready = useClientStore((state) => state.ready);
  const isHost = useClientStore((state) => state.isHost);
  const seatId = useClientStore((state) => state.seatId);
  const [open, setOpen] = useState(false);
  if (!campaign || !ready) return null;
  const role = viewerRole({ campaign, isHost, seatId });
  return (
    <aside aria-label="History tools" className="ui-history-tools">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
        }}
      >
        History
      </button>
      {open && (
        <div className="ui-drawer" style={{ top: '8rem' }}>
          <button
            type="button"
            aria-label="Close History panel"
            onClick={() => {
              setOpen(false);
            }}
          >
            Close
          </button>
          <HistoryPanel key={`${campaign.id}:${seatId ?? ''}:${role}`} />
        </div>
      )}
    </aside>
  );
}
