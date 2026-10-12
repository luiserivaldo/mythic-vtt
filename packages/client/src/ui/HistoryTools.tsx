import { historyGroups } from './history-groups.js';
import { HistoryPage, type HistoryEntry } from '@mythic/shared';
import { useContext, useEffect, useRef, useState } from 'react';
import { loadOrCreateIdentity } from '../net/identity.js';
import { useClientStore } from '../store/react.js';
import { isUndoableType, prune, select, type Selection } from './history-selection.js';
import { SubmitContext } from './submit.js';
import { viewerRole } from './viewer.js';

function HistoryPanel({ canUndo }: { canUndo: boolean }) {
  const campaign = useClientStore((state) => state.campaign);
  const submit = useContext(SubmitContext);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [selection, setSelection] = useState<Selection>({ selected: new Set() });
  const [menu, setMenu] = useState<{ x: number; y: number }>();
  const selectable = entries.filter((entry) => isUndoableType(entry.type)).map((e) => e.seq);
  const selectableKey = selectable.join(',');
  useEffect(() => {
    setSelection((current) => prune(current, selectable));
  }, [selectableKey]);
  useEffect(() => {
    if (!menu) return;
    const close = () => {
      setMenu(undefined);
    };
    window.addEventListener('pointerdown', close);
    return () => {
      window.removeEventListener('pointerdown', close);
    };
  }, [menu]);
  async function undoSelected() {
    setMenu(undefined);
    if (!submit || selection.selected.size === 0) return;
    const result = await submit('history.undo', {
      targetSeqs: [...selection.selected].sort((a, b) => a - b),
    });
    if (!result.ok) return; // the shell has already shown why
    setSelection({ selected: new Set() });
    await load();
  }
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
  }, [seatId, entityId]);
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
      // The host runs one history query at a time and answers 429 to an overlapping one. Our own
      // aborted request (a remount when the viewer's role settles) can still be running there, so
      // a busy answer is retried briefly instead of being shown as a failure.
      let response: Response;
      for (let attempt = 0; ; attempt++) {
        response = await fetch(`/api/history?${query.toString()}`, {
          headers: { Authorization: `Mythic ${identity.identityId}.${identity.identitySecret}` },
          ...(signal ? { signal } : {}),
        });
        if (response.status !== 429 || attempt >= 4) break;
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
        if (signal?.aborted) return;
      }
      if (response.status === 409 || response.status === 410) {
        setBefore(undefined);
        setError('History changed or the page expired. Refresh history to continue.');
        return;
      }
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
      {canUndo && (
        <button
          type="button"
          disabled={busy || selection.selected.size === 0}
          onClick={() => {
            void undoSelected();
          }}
        >
          Undo selected ({selection.selected.size})
        </button>
      )}
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
                <li
                  key={`${entry.sessionId}:${String(entry.seq)}`}
                  data-selected={selection.selected.has(entry.seq) || undefined}
                  onContextMenu={(event) => {
                    if (!canUndo || !selectable.includes(entry.seq)) return;
                    event.preventDefault();
                    if (!selection.selected.has(entry.seq))
                      setSelection((current) => select(current, selectable, entry.seq, 'only'));
                    setMenu({ x: event.clientX, y: event.clientY });
                  }}
                >
                  {canUndo && selectable.includes(entry.seq) && (
                    <input
                      type="checkbox"
                      aria-label={`Select action #${String(entry.seq)}`}
                      checked={selection.selected.has(entry.seq)}
                      onChange={() => undefined}
                      onClick={(event) => {
                        setSelection((current) =>
                          select(
                            current,
                            selectable,
                            entry.seq,
                            event.shiftKey ? 'range' : 'toggle',
                          ),
                        );
                      }}
                    />
                  )}
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
      {menu && (
        <div
          role="menu"
          aria-label="History actions"
          className="ui-history-menu"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation(); // closes the menu, not the whole History panel
              setMenu(undefined);
            }
          }}
        >
          <button
            type="button"
            role="menuitem"
            autoFocus
            onClick={() => {
              void undoSelected();
            }}
          >
            Undo{' '}
            {selection.selected.size > 1 ? `${String(selection.selected.size)} actions` : 'action'}
          </button>
        </div>
      )}
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
  const toggle = useRef<HTMLButtonElement>(null);
  if (!campaign || !ready) return null;
  const role = viewerRole({ campaign, isHost, seatId });
  const close = () => {
    setOpen(false);
    toggle.current?.focus();
  };
  // UX-10: history sits in the right dock with the other panels, so it never covers the board or
  // another drawer. Escape closes it from anywhere inside and hands focus back to the button.
  return (
    <aside
      aria-label="History tools"
      className="ui-history-tools"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) close();
      }}
    >
      <button
        ref={toggle}
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
        }}
      >
        History
      </button>
      {open && (
        <div className="ui-history-body">
          <button type="button" aria-label="Close History panel" onClick={close}>
            Close
          </button>
          <HistoryPanel key={`${campaign.id}:${seatId ?? ''}:${role}`} canUndo={isHost} />
        </div>
      )}
    </aside>
  );
}
