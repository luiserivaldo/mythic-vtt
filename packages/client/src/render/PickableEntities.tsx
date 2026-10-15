import { TokenRings } from './TokenRings.js';
import { walkableFromEntity, type Scene, type Seat } from '@mythic/shared';
import type { ThreeEvent } from '@react-three/fiber';
import { useStore } from 'zustand';
import { Fragment, lazy, Suspense, useEffect, useMemo } from 'react';
import { useClientStore } from '../store/react.js';
import { canSelect, pickEntity, selectionActor, validSelection } from '../tools/selection.js';
import { selectionStore } from '../tools/selection-store.js';
import { tokenMenuStore } from '../ui/token-menu-store.js';
import { focusStore } from './focus-store.js';
import { MapImageMesh } from './MapImage.js';
import { ElevationBadge, SelectionRing, TokenLabel, TokenMaterial } from './TokenSprite.js';
import { TokenStatusMarkers } from './TokenStatusMarkers.js';
import { markerAnchor2d } from './status-markers.js';
import { entityFill } from './token-fill.js';
import { TOKEN_GROUND_FRAME } from './token-frame.js';
import { PrimitiveMesh, type RenderMode } from './PrimitiveMesh.js';
import { RENDER_LAYERS, type RenderEntity, type RenderScene } from './scene-model.js';
import type { RenderGrid } from './grid-model.js';
import { AoEVolume } from './AoEVolume.js';
import { useUiStore } from '../ui/ui-store.js';
import { focusedLayer, visibleEntities } from './layer-visibility.js';
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
  const isHost = useClientStore((state) => state.isHost);
  const seatId = useClientStore((state) => state.seatId);
  const seats = useClientStore((state) => state.campaign?.seats ?? NO_SEATS);
  const selected = useStore(selectionStore, (state) => state.ids);
  const hiddenLayers = useUiStore((state) => state.hiddenLayers);
  const actor = selectionActor(isHost, seatId, seats);
  // MV-244: objects off the active layer are shaded and skipped by picking (host and co-DM only).
  const activeLayer = useUiStore((state) => state.activeLayer);
  const focus = focusedLayer(actor, activeLayer);
  // UI-LAY-01: entities on a hidden layer are not mounted, so they are not drawn or picked.
  const visible = useMemo(
    () => visibleEntities(rendered, scene, hiddenLayers, focus),
    [rendered, scene, hiddenLayers, focus],
  );
  const visibleScene = useMemo(
    () => (rendered ? { ...rendered, entities: visible } : null),
    [rendered, visible],
  );
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
      visible.flatMap((entity) =>
        entity.shape?.walkable
          ? [{ id: entity.id, shape: entity.shape, position: entity.position }]
          : [],
      ),
    [visible],
  );

  useEffect(() => {
    const state = selectionStore.getState();
    state.reconcile(scene?.id ?? null, validSelection(state.ids, scene, actor));
  }, [scene, isHost, seatId, seats]);

  function onClick(event: ThreeEvent<MouseEvent>) {
    if (!scene) return;
    event.stopPropagation();
    const hits = event.intersections.map(({ object, distance }) => ({ id: object.name, distance }));
    const id = pickEntity(hits, scene, actor, focus);
    selectionStore.getState().pick(scene.id, id, event.shiftKey || event.ctrlKey || event.metaKey);
  }

  /**
   * CAM-06: the second click of a double-click focuses the camera on a token. Only tokens are
   * focus targets; the camera move is per-client view state (never an action, never sent), so a
   * spectator may focus too. The ruler tool claims a double-click of its own before this runs.
   */
  function focusOnDoubleClick(entity: RenderEntity) {
    if (!entity.token) return;
    // The token's own base position: world X/Y/Z, so a flying token is framed where it is (TOK-03).
    focusStore.getState().request(entity.position[0], entity.position[1], entity.position[2]);
  }

  /**
   * UI-TOKEN-02/03: both token menus are offered only for a token this viewer may select, so a
   * spectator, an entity on a locked layer or one off the active layer (MV-244) opens nothing.
   */
  function menuToken(entity: RenderEntity): string | null {
    const source = scene?.entities[entity.id];
    if (!source?.token || !scene || entity.dimmed || !canSelect(source, scene, actor)) return null;
    return entity.id;
  }

  /** UI-TOKEN-02: a double-click still focuses (CAM-06) and now also opens the full menu. */
  function openMenuOnDoubleClick(entity: RenderEntity) {
    const id = menuToken(entity);
    if (id !== null) tokenMenuStore.getState().open(id);
  }

  /**
   * UI-TOKEN-03: a right click on a token opens the short menu to its right; on a prop (MV-243) it opens the
   * collidable toggle. Which token is under
   * the pointer is resolved through `pickEntity`, exactly like a left click.
   */
  function onContextMenu(event: ThreeEvent<MouseEvent>) {
    if (!scene) return;
    const hits = event.intersections.map(({ object, distance }) => ({ id: object.name, distance }));
    const id = pickEntity(hits, scene, actor, focus);
    const entity = id === null ? undefined : scene.entities[id];
    if (id === null || !(entity?.token ?? entity?.shape) || !canSelect(entity, scene, actor))
      return;
    event.stopPropagation();
    event.nativeEvent.preventDefault();
    selectionStore.getState().pick(scene.id, id, false);
    tokenMenuStore.getState().openContext(id);
  }

  return (
    <>
      {mode === '3d' && (
        <Suspense fallback={null}>
          <Lighting3D />
          <DropLines rendered={visibleScene} />
        </Suspense>
      )}
      {visible
        .filter((entity) => entity.token && entity.rings?.length)
        .map((entity) => (
          <TokenRings key={entity.id} entity={entity} />
        ))}
      {RENDER_LAYERS.map((layer, order) => (
        <group key={layer} name={layer}>
          {visible
            .filter((entity) => entity.layer === layer)
            .map((entity: RenderEntity) =>
              entity.aoe ? (
                <group key={entity.id}>
                  <AoEVolume
                    volume={entity.aoe}
                    walkables={walkables}
                    mode={mode}
                    renderOrder={order + 1}
                    dimmed={entity.dimmed}
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
                    onContextMenu={onContextMenu}
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
                    onDoubleClick={() => {
                      focusOnDoubleClick(entity);
                      openMenuOnDoubleClick(entity);
                    }}
                    onContextMenu={onContextMenu}
                    walkables={walkables}
                  />
                </Suspense>
              ) : (
                <Fragment key={entity.id}>
                  {/* M1-34: the image spins about the token centre (world Y); the label and badge
                      are screen-projected (CAM-04) and stay fixed. */}
                  <group position={[...entity.position]}>
                    <group rotation={[0, entity.token?.yaw ?? 0, 0]}>
                      <mesh
                        name={entity.id}
                        rotation={[-Math.PI / 2, 0, 0]}
                        renderOrder={order}
                        onClick={onClick}
                        onContextMenu={onContextMenu}
                        onDoubleClick={() => {
                          focusOnDoubleClick(entity);
                          openMenuOnDoubleClick(entity);
                        }}
                      >
                        <planeGeometry args={[entity.sizeCells, entity.sizeCells]} />
                        <TokenMaterial
                          entity={entity}
                          color={entityFill(entity, selected.includes(entity.id)).color}
                        />
                        {entityFill(entity, selected.includes(entity.id)).ring && (
                          <SelectionRing size={entity.sizeCells} />
                        )}
                      </mesh>
                    </group>
                    {/* Anchors are authored in the token's ground plane; the frame keeps them there. */}
                    <group rotation={TOKEN_GROUND_FRAME}>
                      <TokenLabel entity={entity} actor={actor} />
                      <ElevationBadge entity={entity} actor={actor} walkables={walkables} />
                      <TokenStatusMarkers
                        entity={entity}
                        actor={actor}
                        anchor={markerAnchor2d(entity.sizeCells)}
                      />
                    </group>
                  </group>
                </Fragment>
              ),
            )}
        </group>
      ))}
    </>
  );
}
