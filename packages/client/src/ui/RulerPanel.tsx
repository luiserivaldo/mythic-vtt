import type { Scene } from '@mythic/shared';
import { useStore } from 'zustand';
import { rulerStore } from '../tools/ruler-store.js';
import { aoeToolStore } from '../tools/aoe-tool-store.js';
import { activateMeasurement, MEASUREMENT_SHAPES } from '../tools/measurement-tool.js';
import { AoEToolPanel } from './AoEToolPanel.js';

/** Q29: measurement settings share one DOM panel in either board view. */
export function RulerPanel({ scene }: { scene: Scene }) {
  const settings = useStore(rulerStore);
  const aoeActive = useStore(aoeToolStore, (s) => s.active);
  const draft = useStore(aoeToolStore, (s) => s.draft);
  return (
    <section aria-label="Ruler tool">
      <label>
        Measure in{' '}
        <select
          aria-label="Measurement mode"
          value={settings.mode}
          onChange={(e) => {
            settings.setPreferences({ mode: e.target.value === '3d' ? '3d' : '2d' });
          }}
        >
          <option value="2d">2D</option>
          <option value="3d">3D</option>
        </select>
      </label>
      <details open={aoeActive}>
        <summary>Measurement shapes</summary>
        <label>
          Shape{' '}
          <select
            aria-label="Measurement shape"
            value={aoeActive ? draft.kind : 'distance'}
            onChange={(e) => {
              const shape = MEASUREMENT_SHAPES.find((s) => s.kind === e.target.value);
              activateMeasurement(shape?.kind ?? 'distance');
            }}
          >
            <option value="distance">Distance</option>
            {MEASUREMENT_SHAPES.map((s) => (
              <option key={s.kind} value={s.kind}>
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
            settings.setPreferences({ measureMovement: e.target.checked });
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
            settings.setPersistent(e.target.value === 'linger');
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
            settings.setPreferences({ snap: e.target.checked });
          }}
        />{' '}
        Grid snapping
      </label>
      <label>
        <input
          type="checkbox"
          checked={settings.broadcast}
          onChange={(e) => {
            settings.setPreferences({ broadcast: e.target.checked });
          }}
        />{' '}
        Broadcast to others
      </label>
      <p>Ruler previews can be private. Placed AoEs remain shared until replaced or deleted.</p>
      {aoeActive && <AoEToolPanel scene={scene} unified />}
    </section>
  );
}
