import type { Scene, Seat } from '@mythic/shared';
import type { ThreeEvent } from '@react-three/fiber';
import { useStore } from 'zustand';
import { useEffect } from 'react';
import { useClientStore } from '../store/react.js';
import { pickEntity, validSelection, type SelectionActor } from '../tools/selection.js';
import { selectionStore } from '../tools/selection-store.js';
import { MapImageMesh } from './MapImage.js';
import { ElevationBadge, SelectionRing, TokenLabel, TokenMaterial } from './TokenSprite.js';
import { entityFill } from './token-fill.js';
import { TokenStandee } from './TokenStandee.js';
import { PrimitiveLights, PrimitiveMesh, type RenderMode } from './PrimitiveMesh.js';
import { RENDER_LAYERS, type RenderEntity, type RenderScene } from './scene-model.js';

function actorFor(seatId: string | null, seats: SceneSelectionSeats): SelectionActor {
  if (seatId === null) return { kind: 'host' };
  const seat = seats[seatId];
  return seat ? { kind: 'seat', seat } : { kind: 'spectator' };
}

type SceneSelectionSeats = Record<string, Seat>;

// Stable fallback: a fresh `{}` inside a store selector changes identity on every read and
// makes React re-render forever while no campaign has loaded yet.
const NO_SEATS: SceneSelectionSeats = {};

export function PickableEntities({
  rendered,
  scene,
  additiveMode,
  mode = '2d',
}: {
  rendered: RenderScene | null;
  scene: Scene | null;
  additiveMode: boolean;
  /** 3D is only reachable explicitly until the 2D/3D toggle exists (M2-05). */
  mode?: RenderMode;
}) {
  const seatId = useClientStore((state) => state.seatId);
  const seats = useClientStore((state) => state.campaign?.seats ?? NO_SEATS);
  const selected = useStore(selectionStore, (state) => state.ids);
  const actor = actorFor(seatId, seats);

  useEffect(() => {
    const state = selectionStore.getState();
    state.reconcile(scene?.id ?? null, validSelection(state.ids, scene, actor));
  }, [scene, seatId, seats]);

  function onClick(event: ThreeEvent<MouseEvent>) {
    if (!scene) return;
    event.stopPropagation();
    const hits = event.intersections.map(({ object, distance }) => ({ id: object.name, distance }));
    const id = pickEntity(hits, scene, actor);
    selectionStore
      .getState()
      .pick(scene.id, id, additiveMode || event.shiftKey || event.ctrlKey || event.metaKey);
  }

  return (
    <>
      {mode === '3d' && <PrimitiveLights />}
      {RENDER_LAYERS.map((layer, order) => (
        <group key={layer} name={layer}>
          {rendered?.entities
            .filter((entity) => entity.layer === layer)
            .map((entity: RenderEntity) =>
              entity.mapImage ? (
                <MapImageMesh
                  key={entity.id}
                  entity={entity}
                  mapImage={entity.mapImage}
                  renderOrder={order}
                  selected={selected.includes(entity.id)}
                  onPick={onClick}
                />
              ) : entity.shape ? (
                <PrimitiveMesh
                  key={entity.id}
                  entity={entity}
                  shape={entity.shape}
                  mode={mode}
                  selected={selected.includes(entity.id)}
                  renderOrder={order}
                  onClick={onClick}
                />
              ) : mode === '3d' && entity.token ? (
                <TokenStandee
                  key={entity.id}
                  entity={entity}
                  color={entityFill(entity, selected.includes(entity.id)).color}
                  selected={selected.includes(entity.id)}
                  actor={actor}
                  renderOrder={order}
                  onClick={onClick}
                />
              ) : (
                <mesh
                  key={entity.id}
                  name={entity.id}
                  position={[...entity.position]}
                  rotation={[-Math.PI / 2, 0, 0]}
                  renderOrder={order}
                  onClick={onClick}
                >
                  <planeGeometry args={[entity.sizeCells, entity.sizeCells]} />
                  <TokenMaterial
                    entity={entity}
                    color={entityFill(entity, selected.includes(entity.id)).color}
                  />
                  {entityFill(entity, selected.includes(entity.id)).ring && (
                    <SelectionRing size={entity.sizeCells} />
                  )}
                  <TokenLabel entity={entity} actor={actor} />
                  <ElevationBadge entity={entity} actor={actor} />
                </mesh>
              ),
            )}
        </group>
      ))}
    </>
  );
}
