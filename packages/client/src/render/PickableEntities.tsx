import { walkableFromEntity, type Scene, type Seat } from '@mythic/shared';
import type { ThreeEvent } from '@react-three/fiber';
import { useStore } from 'zustand';
import { Fragment, lazy, Suspense, useEffect, useMemo } from 'react';
import { useClientStore } from '../store/react.js';
import { pickEntity, validSelection, type SelectionActor } from '../tools/selection.js';
import { selectionStore } from '../tools/selection-store.js';
import { MapImageMesh } from './MapImage.js';
import { ElevationBadge, SelectionRing, TokenLabel, TokenMaterial } from './TokenSprite.js';
import { entityFill } from './token-fill.js';
import { PrimitiveMesh, type RenderMode } from './PrimitiveMesh.js';
import { RENDER_LAYERS, type RenderEntity, type RenderScene } from './scene-model.js';
import type { RenderGrid } from './grid-model.js';
import { AoEVolume } from './AoEVolume.js';
import { useUiStore } from '../ui/ui-store.js';
import type { ElevatedGridSurface } from './elevated-grid.js';

const Lighting3D = lazy(async () => {
  const module = await import('./Lighting3D.js');
  return { default: module.Lighting3D };
});
const DropLines = lazy(async () => {
  const module = await import('./DropLines.js');
  return { default: module.DropLines };
});
const TokenStandee = lazy(async () => {
  const module = await import('./TokenStandee.js');
  return { default: module.TokenStandee };
});
const ElevatedSurfaceGrid = lazy(async () => {
  const module = await import('./ElevatedSurfaceGrid.js');
  return { default: module.ElevatedSurfaceGrid };
});

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
  mode = '2d',
  grid = null,
}: {
  rendered: RenderScene | null;
  scene: Scene | null;
  /** 3D is only reachable explicitly until the 2D/3D toggle exists (M2-05). */
  mode?: RenderMode;
  /** GRID-05: scene grid style for walkable tops (3D only). */
  grid?: RenderGrid | null;
}) {
  const seatId = useClientStore((state) => state.seatId);
  const seats = useClientStore((state) => state.campaign?.seats ?? NO_SEATS);
  const selected = useStore(selectionStore, (state) => state.ids);
  const hiddenLayers = useUiStore((state) => state.hiddenLayers);
  const actor = actorFor(seatId, seats);
  const walkables = useMemo(
    () =>
      Object.values(scene?.entities ?? {}).flatMap((entity) => {
        if (hiddenLayers.has(entity.layer)) return [];
        const surface = walkableFromEntity(entity);
        return surface ? [surface] : [];
      }),
    [scene, hiddenLayers],
  );
  const gridSurfaces = useMemo<readonly ElevatedGridSurface[]>(
    () =>
      (rendered?.entities ?? []).flatMap((entity) =>
        entity.shape?.walkable && !hiddenLayers.has(scene?.entities[entity.id]?.layer ?? 'effects')
          ? [{ id: entity.id, shape: entity.shape, position: entity.position }]
          : [],
      ),
    [rendered, scene, hiddenLayers],
  );

  useEffect(() => {
    const state = selectionStore.getState();
    state.reconcile(scene?.id ?? null, validSelection(state.ids, scene, actor));
  }, [scene, seatId, seats]);

  function onClick(event: ThreeEvent<MouseEvent>) {
    if (!scene) return;
    event.stopPropagation();
    const hits = event.intersections.map(({ object, distance }) => ({ id: object.name, distance }));
    const id = pickEntity(hits, scene, actor);
    selectionStore.getState().pick(scene.id, id, event.shiftKey || event.ctrlKey || event.metaKey);
  }

  return (
    <>
      {mode === '3d' && (
        <Suspense fallback={null}>
          <Lighting3D />
          <DropLines rendered={rendered} />
        </Suspense>
      )}
      {RENDER_LAYERS.map((layer, order) => (
        <group key={layer} name={layer}>
          {rendered?.entities
            .filter((entity) => entity.layer === layer)
            .map((entity: RenderEntity) =>
              entity.aoe ? (
                hiddenLayers.has(scene?.entities[entity.id]?.layer ?? 'effects') ? null : (
                  <group key={entity.id}>
                    <AoEVolume
                      volume={entity.aoe}
                      walkables={walkables}
                      mode={mode}
                      renderOrder={order + 1}
                    />
                    <mesh
                      name={entity.id}
                      position={[entity.position[0], entity.position[1] + 0.06, entity.position[2]]}
                      rotation={[-Math.PI / 2, 0, 0]}
                      onClick={onClick}
                    >
                      <circleGeometry
                        args={[
                          Math.max(
                            0.25,
                            entity.aoe.shape.kind === 'sphere' ||
                              entity.aoe.shape.kind === 'cylinder' ||
                              entity.aoe.shape.kind === 'cone'
                              ? entity.aoe.shape.radius
                              : entity.aoe.shape.kind === 'cube'
                                ? entity.aoe.shape.size / 2
                                : entity.aoe.shape.width / 2,
                          ),
                          32,
                        ]}
                      />
                      <meshBasicMaterial visible={false} />
                    </mesh>
                  </group>
                )
              ) : entity.mapImage ? (
                <MapImageMesh
                  key={entity.id}
                  entity={entity}
                  mapImage={entity.mapImage}
                  renderOrder={order}
                  selected={selected.includes(entity.id)}
                  onPick={onClick}
                />
              ) : entity.shape ? (
                <Fragment key={entity.id}>
                  <PrimitiveMesh
                    entity={entity}
                    shape={entity.shape}
                    mode={mode}
                    selected={selected.includes(entity.id)}
                    renderOrder={order}
                    onClick={onClick}
                  />
                  {mode === '3d' && grid && entity.shape.walkable && entity.shape.showGridOnTop && (
                    <Suspense fallback={null}>
                      <ElevatedSurfaceGrid
                        entity={entity}
                        shape={entity.shape}
                        grid={grid}
                        renderOrder={order + 1}
                        surfaces={gridSurfaces}
                      />
                    </Suspense>
                  )}
                </Fragment>
              ) : mode === '3d' && entity.token ? (
                <Suspense key={entity.id} fallback={null}>
                  <TokenStandee
                    entity={entity}
                    color={entityFill(entity, selected.includes(entity.id)).color}
                    selected={selected.includes(entity.id)}
                    actor={actor}
                    renderOrder={order}
                    onClick={onClick}
                  />
                </Suspense>
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
