import { canPerform, TokenRing, type Campaign, type Entity, type Scene } from '@mythic/shared';
import { useState } from 'react';
import { useClientStore } from '../store/react.js';
import { useSubmit } from './submit.js';

export function TokenRingsPanel({
  campaign,
  scene,
  entity,
}: {
  campaign: Campaign;
  scene: Scene;
  entity: Entity;
}) {
  const isHost = useClientStore((state) => state.isHost);
  const seatId = useClientStore((state) => state.seatId);
  const [radius, setRadius] = useState('10');
  const [color, setColor] = useState('#55aaff');
  const { send, error } = useSubmit();
  const rings = entity.token?.rings ?? [];
  const actor = isHost
    ? { kind: 'host' as const }
    : { kind: 'seat' as const, ...(seatId ? { seatId } : {}) };
  const allowed = canPerform(campaign, actor, 'token.setRings', {
    sceneId: scene.id,
    entityId: entity.id,
    rings,
  });
  const parsed = TokenRing.safeParse({ radius: Number(radius), color });
  const save = (next: typeof rings) => {
    void send({
      type: 'token.setRings',
      sceneId: scene.id,
      payload: { sceneId: scene.id, entityId: entity.id, rings: next },
    });
  };
  return (
    <section aria-label="Token rings">
      <ul>
        {rings.map((ring, index) => (
          <li key={index}>
            {ring.radius} {scene.grid.unitLabel} <span style={{ color: ring.color }}>●</span>
            <button
              type="button"
              disabled={!allowed}
              aria-label={`Remove ring ${String(index + 1)}`}
              onClick={() => {
                save(rings.filter((_, item) => item !== index));
              }}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <label>
        Ring radius ({scene.grid.unitLabel})
        <input
          type="number"
          min="0"
          step="any"
          value={radius}
          onChange={(event) => {
            setRadius(event.target.value);
          }}
        />
      </label>
      <label>
        Ring colour
        <input
          type="color"
          value={color}
          onChange={(event) => {
            setColor(event.target.value);
          }}
        />
      </label>
      <button
        type="button"
        disabled={!allowed || !parsed.success || rings.length >= 8}
        onClick={() => {
          if (parsed.success) save([...rings, parsed.data]);
        }}
      >
        Add ring
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
