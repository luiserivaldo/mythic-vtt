import {
  canPerform,
  Initiative,
  InitiativeValue,
  previousInitiative,
  sortInitiative,
  type Campaign,
  type Scene,
} from '@mythic/shared';
import { useState, type KeyboardEvent } from 'react';
import { useClientStore } from '../store/react.js';
import { useViewedCampaign } from '../store/viewed-campaign.js';
import { useSubmit } from './submit.js';
import { activeToolStore } from '../tools/active-tool-store.js';

/** UI-TOOL-05: a score field that commits on Enter or blur, so the row re-sorts once per edit. */
function ScoreInput({
  label,
  score,
  onCommit,
}: {
  label: string;
  score: number | undefined;
  onCommit: (score: number | undefined) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = score === undefined ? '' : String(score);
  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    if (draft.trim() === '') {
      if (score !== undefined) onCommit(undefined);
      return;
    }
    const parsed = InitiativeValue.safeParse(Number(draft));
    if (parsed.success && parsed.data !== score) onCommit(parsed.data);
  };
  return (
    <input
      className="ui-initiative-score"
      type="number"
      step="any"
      inputMode="decimal"
      aria-label={label}
      value={draft ?? shown}
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
        else if (event.key === 'Escape' && draft !== null) {
          event.stopPropagation();
          setDraft(null);
        }
      }}
    />
  );
}

function InitiativePanel({ campaign, scene }: { campaign: Campaign; scene: Scene }) {
  const isHost = useClientStore((state) => state.isHost);
  const seatId = useClientStore((state) => state.seatId);
  const preview = useClientStore((state) => state.viewAs.kind !== 'host');
  const { send, error } = useSubmit();
  const current: Initiative = scene.initiative ?? { round: 1, order: [], activeEntityId: null };
  // A round draft belongs to the round it edits; advancing/wrapping refreshes the field.
  const [roundDraft, setRoundDraft] = useState<{ base: number; value: string } | null>(null);
  const round = roundDraft?.base === current.round ? roundDraft.value : String(current.round);
  const [selected, setSelected] = useState('');
  const actor = isHost
    ? { kind: 'host' as const }
    : { kind: 'seat' as const, ...(seatId ? { seatId } : {}) };
  // Spectators, players and the DM previewing another view get the list with no controls.
  const allowed =
    !preview &&
    canPerform(campaign, actor, 'initiative.set', { sceneId: scene.id, initiative: current });
  const save = (initiative: Initiative) => {
    void send({
      type: 'initiative.set',
      sceneId: scene.id,
      payload: { sceneId: scene.id, initiative },
    });
  };
  const values = current.values ?? {};
  const setScore = (id: string, score: number | undefined) => {
    const next = { ...values };
    if (score === undefined) Reflect.deleteProperty(next, id);
    else next[id] = score;
    save(sortInitiative({ ...current, values: next }));
  };
  const back = previousInitiative(current);
  const canAdvance =
    allowed && canPerform(campaign, actor, 'initiative.advance', { sceneId: scene.id });
  const advance = () => {
    if (!canAdvance) return;
    void send({
      type: 'initiative.advance',
      sceneId: scene.id,
      payload: { sceneId: scene.id },
    });
  };
  const retreat = () => {
    if (allowed && back) save(back);
  };
  // UI-TOOL-05: the arrow keys step the turn around the loop while focus is in the list.
  const onListKey = (event: KeyboardEvent<HTMLElement>) => {
    if (!allowed || event.target instanceof HTMLInputElement) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') advance();
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') retreat();
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  const candidates = Object.values(scene.entities).filter(
    (entity) => entity.token && !current.order.includes(entity.id),
  );
  const roundUpdate = Initiative.safeParse({ ...current, round: Number(round) });
  const turn =
    current.activeEntityId === null ? 0 : current.order.indexOf(current.activeEntityId) + 1;
  return (
    <section className="ui-panel ui-initiative" aria-label="Rounds and initiative">
      <p>
        Round {current.round} · Turn {turn || '—'}
      </p>
      <ol
        className="ui-initiative-list"
        aria-label="Turn order"
        tabIndex={allowed ? 0 : undefined}
        onKeyDown={onListKey}
      >
        {current.order.map((id, index) => {
          const name = scene.entities[id]?.name || 'Unnamed token';
          const active = current.activeEntityId === id;
          return (
            <li key={id} aria-current={active ? 'step' : undefined} data-active={active}>
              <span className="ui-initiative-rank">{index + 1}.</span>
              <span className="ui-initiative-name">{name}</span>
              {allowed ? (
                <>
                  <ScoreInput
                    label={`Initiative for ${name}`}
                    score={values[id]}
                    onCommit={(score) => {
                      setScore(id, score);
                    }}
                  />
                  <button
                    type="button"
                    className="ui-initiative-remove"
                    aria-label={`Remove ${name}`}
                    onClick={() => {
                      const rest = { ...values };
                      Reflect.deleteProperty(rest, id);
                      save({
                        ...current,
                        order: current.order.filter((item) => item !== id),
                        values: rest,
                        activeEntityId: active ? null : current.activeEntityId,
                      });
                    }}
                  >
                    ✕
                  </button>
                </>
              ) : (
                <span className="ui-initiative-score">{values[id] ?? '—'}</span>
              )}
            </li>
          );
        })}
      </ol>
      {allowed && (
        <>
          {/* Playtest F04: the turn buttons sit apart from each other and from the list edits. */}
          <div className="ui-initiative-turns">
            <button type="button" disabled={!back} onClick={retreat}>
              Previous turn
            </button>
            <button type="button" disabled={!canAdvance} onClick={advance}>
              Next turn
            </button>
          </div>
          <button
            type="button"
            aria-pressed={current.ascending === true}
            onClick={() => {
              const { ascending, ...rest } = current;
              save(sortInitiative(ascending ? rest : { ...rest, ascending: true }));
            }}
          >
            {current.ascending ? 'Lowest first' : 'Highest first'}
          </button>
          <div className="ui-initiative-row">
            <label>
              Initiative token
              <select
                value={selected}
                onChange={(event) => {
                  setSelected(event.target.value);
                }}
              >
                <option value="">Choose a token</option>
                {candidates.map((entity) => (
                  <option key={entity.id} value={entity.id}>
                    {entity.name || 'Unnamed token'}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={
                !candidates.some((entity) => entity.id === selected) || current.order.length >= 200
              }
              onClick={() => {
                save({
                  ...current,
                  order: [...current.order, selected],
                  activeEntityId: current.activeEntityId ?? selected,
                });
                setSelected('');
              }}
            >
              Add to initiative
            </button>
          </div>
          <div className="ui-initiative-row">
            <label>
              Set round
              <input
                type="number"
                min="1"
                max="1000000"
                value={round}
                onChange={(event) => {
                  setRoundDraft({ base: current.round, value: event.target.value });
                }}
              />
            </label>
            <button
              type="button"
              disabled={!roundUpdate.success}
              onClick={() => {
                if (roundUpdate.success) save(roundUpdate.data);
              }}
            >
              Apply round
            </button>
          </div>
          <button
            type="button"
            className="ui-initiative-reset"
            onClick={() => {
              save({ round: 1, order: [], activeEntityId: null });
              setRoundDraft(null);
            }}
          >
            Reset encounter
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

/** HIST-05 / UI-TOOL-05: the rail opens the tracker in the left pane, beside its button. */
export function InitiativeTools() {
  const campaign = useViewedCampaign();
  const scene = campaign?.activeSceneId ? campaign.scenes[campaign.activeSceneId] : undefined;
  if (!campaign || !scene) return null;
  return (
    <div
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        activeToolStore.getState().setTool('select');
        document.getElementById('rail-tool-initiative')?.focus();
      }}
    >
      <InitiativePanel key={scene.id} campaign={campaign} scene={scene} />
    </div>
  );
}
