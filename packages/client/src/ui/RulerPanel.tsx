import { canPerform, type Actor, type Scene } from '@mythic/shared';
import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useClientStore } from '../store/react.js';
import { aoePlacePayload } from '../tools/aoe-placement.js';
import {
  activateMeasurement,
  measureShapeChoices,
  measurementScene,
  shapeAfterModeChange,
} from '../tools/measurement-tool.js';
import { useJoinEnv } from './join-context.js';
import { useStore } from 'zustand';
import { rulerStore } from '../tools/ruler-store.js';
import { aoeToolStore } from '../tools/aoe-tool-store.js';
import { AoEToolPanel } from './AoEToolPanel.js';
import { LastingAoELimitControls } from './LastingAoELimitControls.js';
import { useSubmit } from './submit.js';

const NO_PLACE_REASON = 'You cannot place area shapes here';

/**
 * Q29 / UI-MEAS-01..03: the Measure panel. It opens beside the Measure rail button (the left
 * pane) and holds one DOM panel for both board views. Distances use the scene's own unit
 * (`unitLabel`), never a second one.
 */
export function RulerPanel({ scene }: { scene: Scene }) {
  const settings = useStore(
    rulerStore,
    useShallow((s) => ({
      mode: s.mode,
      snap: s.snap,
      broadcast: s.broadcast,
      measureMovement: s.measureMovement,
      persistent: s.persistent,
      phase: s.phase,
    })),
  );
  const join = useJoinEnv();
  const campaign = useClientStore((s) => s.campaign);
  const isHost = useClientStore((s) => s.isHost);
  const seatId = useClientStore((s) => s.seatId);
  const aoeActive = useStore(aoeToolStore, (s) => s.active);
  const draft = useStore(aoeToolStore, (s) => s.draft);
  const busy = useStore(aoeToolStore, (s) => s.busy);
  const { send } = useSubmit();
  const actor: Actor | null = isHost
    ? { kind: 'host', identityId: join?.identityId }
    : seatId
      ? { kind: 'seat', seatId, identityId: join?.identityId }
      : null;
  const canPlace =
    !!campaign &&
    !!actor &&
    !!join &&
    canPerform(
      campaign,
      actor,
      'aoe.place',
      aoePlacePayload(
        scene.id,
        join.identityId,
        aoeToolStore.getInitialState().draft,
        measurementScene(scene),
      ),
    );
  useEffect(() => {
    if (aoeActive && !canPlace) activateMeasurement('distance');
  }, [aoeActive, canPlace]);

  const current = aoeActive ? draft.kind : 'distance';
  // M3-14: a measuring AoE is keyed by the identity that placed it, so "mine" is that one entity.
  const ownAoEId =
    join && scene.entities[join.identityId]?.aoe !== undefined ? join.identityId : null;
  const canClearAoE =
    !!campaign &&
    !!actor &&
    ownAoEId !== null &&
    canPerform(campaign, actor, 'aoe.remove', { sceneId: scene.id, entityId: ownAoEId });
  const hasRuler = settings.phase !== 'idle';
  const clearMine = () => {
    // Clearing the local ruler also tells everyone it was broadcast to (RulerTool's subscription).
    rulerStore.getState().clear();
    if (ownAoEId && canClearAoE)
      void send({
        type: 'aoe.remove',
        sceneId: scene.id,
        payload: { sceneId: scene.id, entityId: ownAoEId },
      });
  };

  return (
    <section aria-label="Measure tool" className="ui-measure">
      <div className="ui-measure-row">
        <label>
          Measure in{' '}
          <select
            aria-label="Measurement mode"
            value={settings.mode}
            onChange={(e) => {
              const mode = e.target.value === '3d' ? '3d' : '2d';
              rulerStore.getState().setPreferences({ mode });
              const next = shapeAfterModeChange(current, mode);
              if (next !== current) activateMeasurement(next);
            }}
          >
            <option value="2d">2D</option>
            <option value="3d">3D</option>
          </select>
        </label>
        <label>
          Fade{' '}
          <select
            aria-label="Ruler fade"
            title="Linger keeps your ruler until you clear it (persistent ruler)"
            value={settings.persistent ? 'linger' : 'instant'}
            onChange={(e) => {
              rulerStore.getState().setPersistent(e.target.value === 'linger');
            }}
          >
            <option value="instant">Instant</option>
            <option value="linger">Linger</option>
          </select>
        </label>
      </div>
      <fieldset role="radiogroup" aria-label="Measurement shape" className="ui-measure-shapes">
        <legend>Shape</legend>
        {measureShapeChoices(settings.mode).map((choice) => {
          const blocked = choice.shape !== 'distance' && !canPlace;
          return (
            <label key={choice.shape} title={blocked ? NO_PLACE_REASON : undefined}>
              <input
                type="radio"
                name="measure-shape"
                value={choice.shape}
                checked={current === choice.shape}
                disabled={blocked}
                onChange={() => {
                  activateMeasurement(choice.shape);
                }}
              />{' '}
              {choice.label}
            </label>
          );
        })}
      </fieldset>
      <p className="ui-measure-hint">
        Drag on the board to size {current === 'distance' ? 'the ruler' : 'the shape'}, read in{' '}
        {scene.grid.unitLabel}.
      </p>
      <label>
        <input
          type="checkbox"
          checked={settings.snap}
          onChange={(e) => {
            rulerStore.getState().setPreferences({ snap: e.target.checked });
          }}
        />{' '}
        Grid snapping
      </label>
      <label>
        <input
          type="checkbox"
          checked={settings.measureMovement}
          onChange={(e) => {
            rulerStore.getState().setPreferences({ measureMovement: e.target.checked });
          }}
        />{' '}
        Always measure token movement
      </label>
      <label>
        <input
          type="checkbox"
          checked={settings.broadcast}
          onChange={(e) => {
            rulerStore.getState().setPreferences({ broadcast: e.target.checked });
          }}
        />{' '}
        Broadcast to others
      </label>
      {aoeActive && <AoEToolPanel scene={scene} unified />}
      <button type="button" disabled={busy || (!hasRuler && !canClearAoE)} onClick={clearMine}>
        Clear mine
      </button>
      {/* Q27: the scene's cap on lasting AoEs is a setting, not part of measuring; kept folded. */}
      <details className="ui-measure-more">
        <summary>Scene AoE limit</summary>
        <LastingAoELimitControls key={scene.id} scene={scene} />
      </details>
    </section>
  );
}
