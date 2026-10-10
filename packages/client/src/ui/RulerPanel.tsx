import { canPerform, type Actor, type Scene } from '@mythic/shared';
import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useClientStore } from '../store/react.js';
import { aoePlacePayload } from '../tools/aoe-placement.js';
import { measurementScene } from '../tools/measurement-tool.js';
import { useJoinEnv } from './join-context.js';
import { useStore } from 'zustand';
import { rulerStore } from '../tools/ruler-store.js';
import { aoeToolStore } from '../tools/aoe-tool-store.js';
import { activateMeasurement, MEASUREMENT_SHAPES } from '../tools/measurement-tool.js';
import { AoEToolPanel } from './AoEToolPanel.js';

/** Q29: measurement settings share one DOM panel in either board view. */
export function RulerPanel({ scene }: { scene: Scene }) {
  const settings = useStore(
    rulerStore,
    useShallow((s) => ({
      mode: s.mode,
      snap: s.snap,
      broadcast: s.broadcast,
      measureMovement: s.measureMovement,
      persistent: s.persistent,
    })),
  );
  const join = useJoinEnv();
  const campaign = useClientStore((s) => s.campaign);
  const isHost = useClientStore((s) => s.isHost);
  const seatId = useClientStore((s) => s.seatId);
  const aoeActive = useStore(aoeToolStore, (s) => s.active);
  const draft = useStore(aoeToolStore, (s) => s.draft);
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
  return (
    <section aria-label="Ruler tool">
      <label>
        Measure in{' '}
        <select
          aria-label="Measurement mode"
          value={settings.mode}
          onChange={(e) => {
            rulerStore.getState().setPreferences({ mode: e.target.value === '3d' ? '3d' : '2d' });
          }}
        >
          <option value="2d">2D</option>
          <option value="3d">3D</option>
        </select>
      </label>
      <details>
        <summary>Measurement shapes</summary>
        <label>
          Shape{' '}
          <select
            aria-label="Measurement shape"
            value={aoeActive ? draft.kind : 'distance'}
            onChange={(e) => {
              const shape = MEASUREMENT_SHAPES.find((s) => s.kind === e.target.value);
              if (!shape || canPlace) activateMeasurement(shape?.kind ?? 'distance');
            }}
          >
            <option value="distance">Distance</option>
            {MEASUREMENT_SHAPES.map((s) => (
              <option key={s.kind} value={s.kind} disabled={!canPlace}>
                {settings.mode === '2d' ? s.flat : s.volume}
              </option>
            ))}
          </select>
        </label>
      </details>
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
        Fade{' '}
        <select
          aria-label="Ruler fade"
          value={settings.persistent ? 'linger' : 'instant'}
          onChange={(e) => {
            rulerStore.getState().setPersistent(e.target.value === 'linger');
          }}
        >
          <option value="instant">Instant</option>
          <option value="linger">Linger</option>
        </select>
      </label>
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
          checked={settings.broadcast}
          onChange={(e) => {
            rulerStore.getState().setPreferences({ broadcast: e.target.checked });
          }}
        />{' '}
        Broadcast to others
      </label>
      <p>Ruler previews can be private. Placed AoEs remain shared until replaced or deleted.</p>
      {aoeActive && <AoEToolPanel scene={scene} unified />}
    </section>
  );
}
