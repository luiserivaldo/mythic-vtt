import { useState } from 'react';
import { canPerform, resolveSceneBounds, type Actor, type Campaign } from '@mythic/shared';
import { useClientStore } from '../store/react.js';
import { newId } from './ids.js';
import { useSubmit } from './submit.js';

export function PrefabPanel({ campaign }: { campaign: Campaign }) {
  const { send, error } = useSubmit();
  const isHost = useClientStore((s) => s.isHost),
    seatId = useClientStore((s) => s.seatId);
  const actor: Actor = isHost
    ? { kind: 'host' }
    : seatId
      ? { kind: 'seat', seatId }
      : { kind: 'seat' };
  const [sourceId, setSourceId] = useState(''),
    [name, setName] = useState('');
  const [prefabId, setPrefabId] = useState('');
  const [targetId, setTargetId] = useState(campaign.activeSceneId ?? '');
  const source = campaign.activeSceneId ? campaign.scenes[campaign.activeSceneId] : undefined;
  const target = campaign.scenes[targetId];
  const prefab = campaign.prefabs?.[prefabId];
  const bounds = target ? resolveSceneBounds(target) : null;
  const [coordinates, setCoordinates] = useState({ x: '', y: '', z: '' });
  const to = {
    x:
      coordinates.x === ''
        ? (bounds?.width ?? 0) / 2
        : Number(coordinates.x) / (target?.grid.unitsPerCell ?? 1),
    y: coordinates.y === '' ? 0 : Number(coordinates.y) / (target?.grid.unitsPerCell ?? 1),
    z:
      coordinates.z === ''
        ? (bounds?.height ?? 0) / 2
        : Number(coordinates.z) / (target?.grid.unitsPerCell ?? 1),
  };
  const candidateId = '0'.repeat(26);
  const save = { sceneId: source?.id ?? '', entityId: sourceId, prefabId: candidateId, name };
  const placement = { sceneId: targetId, prefabId, entityId: candidateId, to };
  return (
    <section aria-labelledby="ui-prefabs-h" className="ui-panel">
      <h2 id="ui-prefabs-h">Prefab library</h2>
      <p>
        Save a configuration, then place independent copies in any scene. Copies start unowned with
        no instance permission overrides.
      </p>
      <label>
        Source entity{' '}
        <select
          value={sourceId}
          onChange={(e) => {
            setSourceId(e.target.value);
          }}
        >
          <option value="">Choose an entity in the active scene</option>
          {Object.values(source?.entities ?? {}).map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.name || 'Unnamed entity'}
            </option>
          ))}
        </select>
      </label>
      <label>
        Prefab name{' '}
        <input
          value={name}
          maxLength={120}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
      </label>
      <button
        type="button"
        disabled={!canPerform(campaign, actor, 'prefab.save', save)}
        onClick={() => {
          void send({
            type: 'prefab.save',
            sceneId: source?.id ?? '',
            payload: { ...save, prefabId: newId() },
          });
        }}
      >
        Save prefab
      </button>
      <label>
        Saved prefab{' '}
        <select
          value={prefabId}
          onChange={(e) => {
            setPrefabId(e.target.value);
          }}
        >
          <option value="">Choose a prefab</option>
          {Object.values(campaign.prefabs ?? {}).map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Target scene{' '}
        <select
          value={targetId}
          onChange={(e) => {
            setTargetId(e.target.value);
            setCoordinates({ x: '', y: '', z: '' });
          }}
        >
          <option value="">Choose a scene</option>
          {Object.values(campaign.scenes).map((scene) => (
            <option key={scene.id} value={scene.id}>
              {scene.name}
            </option>
          ))}
        </select>
      </label>
      {target && (
        <>
          <p>
            Leave positions blank to place at the scene centre. Rotation, scale and components come
            from the prefab.
          </p>
          {(['x', 'y', 'z'] as const).map((axis) => (
            <label key={axis}>
              {`Prefab ${axis.toUpperCase()} (${target.grid.unitLabel})`}{' '}
              <input
                type="number"
                step="any"
                value={coordinates[axis]}
                onChange={(e) => {
                  setCoordinates({ ...coordinates, [axis]: e.target.value });
                }}
              />
            </label>
          ))}
        </>
      )}
      <button
        type="button"
        disabled={!canPerform(campaign, actor, 'prefab.place', placement)}
        onClick={() => {
          void send({
            type: 'prefab.place',
            sceneId: targetId,
            payload: { ...placement, entityId: newId() },
          });
        }}
      >
        Place copy
      </button>
      <button
        type="button"
        disabled={!prefab || !canPerform(campaign, actor, 'prefab.remove', { prefabId })}
        onClick={() => {
          void send({ type: 'prefab.remove', payload: { prefabId } });
        }}
      >
        Delete prefab
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
