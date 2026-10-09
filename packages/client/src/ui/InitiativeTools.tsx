import { canPerform, Initiative, type Campaign, type Scene } from '@mythic/shared';
import { useState } from 'react';
import { useClientStore } from '../store/react.js';
import { useSubmit } from './submit.js';

function InitiativePanel({ campaign, scene }: { campaign: Campaign; scene: Scene }) {
  const isHost = useClientStore((state) => state.isHost);
  const seatId = useClientStore((state) => state.seatId);
  const { send, error } = useSubmit();
  const current: Initiative = scene.initiative ?? { round: 1, order: [], activeEntityId: null };
  const [round, setRound] = useState(String(current.round));
  const [selected, setSelected] = useState('');
  const actor = isHost
    ? { kind: 'host' as const }
    : { kind: 'seat' as const, ...(seatId ? { seatId } : {}) };
  const allowed = canPerform(campaign, actor, 'initiative.set', {
    sceneId: scene.id,
    initiative: current,
  });
  const save = (initiative: Initiative) => {
    void send({
      type: 'initiative.set',
      sceneId: scene.id,
      payload: { sceneId: scene.id, initiative },
    });
  };
  const reorder = (index: number, step: number) => {
    const order = [...current.order];
    const value = order[index];
    const other = order[index + step];
    if (value === undefined || other === undefined) return;
    order[index] = other;
    order[index + step] = value;
    save({ ...current, order });
  };
  const candidates = Object.values(scene.entities).filter(
    (entity) => entity.token && !current.order.includes(entity.id),
  );
  const roundUpdate = Initiative.safeParse({ ...current, round: Number(round) });
  const turn =
    current.activeEntityId === null ? 0 : current.order.indexOf(current.activeEntityId) + 1;
  return (
    <section className="ui-panel" aria-label="Rounds and initiative">
      <h2>Rounds and initiative</h2>
      <p>
        Round {current.round} · Turn {turn || '—'}
      </p>
      <ol>
        {current.order.map((id, index) => (
          <li key={id} aria-current={current.activeEntityId === id ? 'step' : undefined}>
            {scene.entities[id]?.name || 'Unnamed token'}
            {current.activeEntityId === id && ' (current)'}
            {allowed && (
              <>
                <button
                  type="button"
                  aria-label={`Earlier ${String(index + 1)}`}
                  disabled={index === 0}
                  onClick={() => {
                    reorder(index, -1);
                  }}
                >
                  Up
                </button>
                <button
                  type="button"
                  aria-label={`Later ${String(index + 1)}`}
                  disabled={index === current.order.length - 1}
                  onClick={() => {
                    reorder(index, 1);
                  }}
                >
                  Down
                </button>
                <button
                  type="button"
                  aria-label={`Current turn ${String(index + 1)}`}
                  onClick={() => {
                    save({ ...current, activeEntityId: id });
                  }}
                >
                  Current
                </button>
                <button
                  type="button"
                  aria-label={`Remove combatant ${String(index + 1)}`}
                  onClick={() => {
                    save({
                      ...current,
                      order: current.order.filter((item) => item !== id),
                      activeEntityId: current.activeEntityId === id ? null : current.activeEntityId,
                    });
                  }}
                >
                  Remove
                </button>
              </>
            )}
          </li>
        ))}
      </ol>
      {allowed && (
        <>
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
          <button
            type="button"
            disabled={!canPerform(campaign, actor, 'initiative.advance', { sceneId: scene.id })}
            onClick={() => {
              void send({
                type: 'initiative.advance',
                sceneId: scene.id,
                payload: { sceneId: scene.id },
              });
            }}
          >
            Next turn
          </button>
          <label>
            Set round
            <input
              type="number"
              min="1"
              max="1000000"
              value={round}
              onChange={(event) => {
                setRound(event.target.value);
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
          <button
            type="button"
            onClick={() => {
              save({ round: 1, order: [], activeEntityId: null });
              setRound('1');
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

export function InitiativeTools() {
  const campaign = useClientStore((state) => state.campaign);
  const [open, setOpen] = useState(false);
  const scene = campaign?.activeSceneId ? campaign.scenes[campaign.activeSceneId] : undefined;
  if (!campaign || !scene) return null;
  return (
    <aside className="ui-initiative-tools" aria-label="Initiative tools">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
        }}
      >
        Rounds
      </button>
      {open && (
        <div className="ui-drawer" style={{ top: '8rem' }}>
          <button
            type="button"
            aria-label="Close Rounds panel"
            onClick={() => {
              setOpen(false);
            }}
          >
            Close
          </button>
          <InitiativePanel key={scene.id} campaign={campaign} scene={scene} />
        </div>
      )}
    </aside>
  );
}
