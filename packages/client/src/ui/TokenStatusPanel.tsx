import {
  canPerform,
  canReadEntityLabel,
  StatusIcon,
  TokenStatusMarker,
  TokenStatusMarkers,
  type Campaign,
  type Entity,
  type Scene,
} from '@mythic/shared';
import { useState } from 'react';
import { STATUS_ICON_GLYPHS, statusIconLabel } from '../render/status-markers.js';
import { useClientStore } from '../store/react.js';
import { useSubmit } from './submit.js';

export function TokenStatusPanel({
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
  const [icon, setIcon] = useState<StatusIcon>('blinded');
  const [text, setText] = useState('');
  const { send, error } = useSubmit();
  const markers = entity.token?.statusMarkers ?? [];
  const actor = isHost
    ? { kind: 'host' as const }
    : { kind: 'seat' as const, ...(seatId ? { seatId } : {}) };
  const allowed = canPerform(campaign, actor, 'token.setStatusMarkers', {
    sceneId: scene.id,
    entityId: entity.id,
    markers,
  });
  const textMarker = TokenStatusMarker.safeParse({ kind: 'text', text });
  const iconMarker: TokenStatusMarker = { kind: 'icon', icon };
  const canAdd = (marker: TokenStatusMarker) =>
    allowed && TokenStatusMarkers.safeParse([...markers, marker]).success;
  const save = (next: TokenStatusMarker[]) => {
    void send({
      type: 'token.setStatusMarkers',
      sceneId: scene.id,
      payload: { sceneId: scene.id, entityId: entity.id, markers: next },
    });
  };
  if (!canReadEntityLabel(campaign, actor, entity)) return null;
  return (
    <section aria-label="Token status markers">
      <ul>
        {markers.map((marker, index) => (
          <li key={index}>
            {marker.kind === 'icon'
              ? `${STATUS_ICON_GLYPHS[marker.icon]} ${statusIconLabel(marker.icon)}`
              : marker.text}
            <button
              type="button"
              disabled={!allowed}
              aria-label={`Remove marker ${String(index + 1)}`}
              onClick={() => {
                save(markers.filter((_, item) => item !== index));
              }}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <label>
        Status icon
        <select
          value={icon}
          disabled={!allowed}
          onChange={(event) => {
            const parsed = StatusIcon.safeParse(event.target.value);
            if (parsed.success) setIcon(parsed.data);
          }}
        >
          {StatusIcon.options.map((value) => (
            <option key={value} value={value}>
              {STATUS_ICON_GLYPHS[value]} {statusIconLabel(value)}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={!canAdd(iconMarker)}
        onClick={() => {
          save([...markers, iconMarker]);
        }}
      >
        Add status icon
      </button>
      <label>
        Custom marker
        <input
          value={text}
          maxLength={80}
          disabled={!allowed}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
      </label>
      <button
        type="button"
        disabled={!textMarker.success || !canAdd(textMarker.data)}
        onClick={() => {
          if (textMarker.success) {
            save([...markers, textMarker.data]);
            setText('');
          }
        }}
      >
        Add custom marker
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
