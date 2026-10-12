import { resolvePlayerToggles, type PlayerToggle, type Scene } from '@mythic/shared';
import { useSubmit } from './submit.js';

const TOGGLES: readonly { key: PlayerToggle; label: string }[] = [
  { key: 'measure', label: 'Players may measure' },
  { key: 'draw', label: 'Players may draw' },
  { key: 'pins', label: 'Players may place pins' },
];

/** PERM-05: DM panel for the per-scene player toggles. The host and co-DMs are never limited. */
export function SceneTogglesForm({ scene }: { scene: Scene | null }) {
  return scene ? <TogglesForm scene={scene} /> : null;
}

function TogglesForm({ scene }: { scene: Scene }) {
  const { send, error } = useSubmit();
  const current = resolvePlayerToggles(scene);
  return (
    <fieldset>
      <legend>Player permissions</legend>
      {TOGGLES.map(({ key, label }) => (
        <label key={key}>
          <input
            type="checkbox"
            checked={current[key]}
            onChange={(e) => {
              void send({
                type: 'scene.setPlayerToggles',
                sceneId: scene.id,
                payload: { sceneId: scene.id, toggles: { [key]: e.target.checked } },
              });
            }}
          />{' '}
          {label}
        </label>
      ))}
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
