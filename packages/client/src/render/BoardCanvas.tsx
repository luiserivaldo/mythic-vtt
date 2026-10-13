import { useViewedCampaign } from '../store/viewed-campaign.js';
import { SceneOverlay } from './SceneOverlay.js';
import { Canvas, useThree } from '@react-three/fiber';
import { resolveSceneBounds, type Scene, type SceneBounds } from '@mythic/shared';
import { OrthographicCamera } from '@react-three/drei';
import { lazy, Suspense, useEffect, useMemo } from 'react';
import { useStore } from 'zustand';
import { tokenDragStore } from '../tools/token-drag-store.js';
import { withLocalDrag } from '../tools/token-drag.js';
import { useClientStore } from '../store/react.js';
import { activeRenderScene, type RenderScene } from './scene-model.js';
import { PickableEntities } from './PickableEntities.js';
import { RangeReadout } from './RangeReadout.js';
import { TokenPreviewCard } from './TokenPreviewCard.js';
import { selectionStore } from '../tools/selection-store.js';
import { GridLines } from './GridLines.js';
import { activeRenderGrid, type RenderGrid } from './grid-model.js';
import { PanZoomControls } from './PanZoomControls.js';
import { RulerTool } from './RulerTool.js';
import { ToolRail } from '../ui/ToolRail.js';
import { rulerStore } from '../tools/ruler-store.js';
import { TokenDrag } from './TokenDrag.js';
import { TransformGizmo } from './TransformGizmo.js';
import { DEFAULT_BACKGROUND, resolveBackground } from './skybox-model.js';
import { outsideColor } from './canvas-style.js';
import type { GroundBounds } from './camera-3d.js';
import { useViewMode, viewModeStore, type ViewMode } from './view-mode-store.js';
import { useViewDirector } from './use-view-director.js';
import { AoEPlacementCanvas } from './AoEPlacementCanvas.js';
import { aoeToolStore } from '../tools/aoe-tool-store.js';
import { AoEHighlights } from './AoEHighlights.js';
import { OcclusionFade } from './OcclusionFade.js';
import { FocusCamera } from './FocusCamera.js';
import { RenderDiagnostics } from './RenderDiagnostics.js';
import { ToolPanelDock } from '../ui/ToolPanelDock.js';
import { isReadOnlyViewer } from '../ui/viewer.js';
import { handleBoardEscape } from './board-keyboard.js';

const OrbitControls3D = lazy(async () => {
  const module = await import('./OrbitControls3D.js');
  return { default: module.OrbitControls3D };
});
const Skybox = lazy(async () => {
  const module = await import('./Skybox.js');
  return { default: module.Skybox };
});
const TransformGizmo3D = lazy(async () => {
  const module = await import('./TransformGizmo3D.js');
  return { default: module.TransformGizmo3D };
});

function BoardScene({
  scene,
  source,
  grid,
  viewMode,
  bounds,
  canvasSize,
  frameKey,
  resetToken,
  readOnly,
}: {
  scene: RenderScene | null;
  source: Scene | null;
  grid: RenderGrid | null;
  viewMode: ViewMode;
  bounds: GroundBounds | null;
  canvasSize: SceneBounds;
  frameKey: string;
  resetToken: number;
  readOnly: boolean;
}) {
  const invalidate = useThree((state) => state.invalidate);
  const aoeActive = useStore(aoeToolStore, (s) => s.active);
  const rulerActive = useStore(rulerStore, (s) => s.tool);
  const localDrag = useStore(tokenDragStore, (state) => state.local);
  const shown = useMemo(() => withLocalDrag(scene, localDrag), [scene, localDrag]);
  useEffect(() => {
    invalidate();
  }, [shown, invalidate]);
  // M2-05: the camera, tokens, lighting and skybox follow the *rendered* mode, which trails the
  // requested one until the return tween has finished.
  const director = useViewDirector(viewMode, bounds);
  const mode3d = director.rendered === '3d';
  useEffect(() => {
    invalidate();
  }, [mode3d, invalidate]);

  const backdrop = useMemo(
    () => resolveBackground(scene?.background, scene?.zenith),
    [scene?.background, scene?.zenith],
  );
  return (
    <>
      {/* D37: outside the canvas is a darker neutral; GridLines fills the inside. */}
      <color attach="background" args={[outsideColor(scene?.background)]} />
      {mode3d && backdrop.zenith && (
        <Suspense fallback={null}>
          <Skybox spec={backdrop} />
        </Suspense>
      )}
      {mode3d ? (
        <Suspense fallback={null}>
          <OrbitControls3D
            bounds={bounds}
            resetToken={resetToken}
            orbitRef={director.orbitRef}
            applyRef={director.applyRef}
            keepInitialOrbit={director.keepInitialOrbit}
            leftPanEnabled={!aoeActive && !rulerActive}
          />
        </Suspense>
      ) : (
        <>
          <PanZoomControls
            bounds={canvasSize}
            frameKey={`${frameKey}:${String(resetToken)}`}
            initialView={director.restored2d ? director.view2d : undefined}
          />
          <OrthographicCamera
            makeDefault
            position={[director.view2d.centerX, 20, director.view2d.centerZ]}
            up={[0, 0, -1]}
            rotation={[-Math.PI / 2, 0, 0]}
            zoom={director.view2d.zoom}
            near={0.1}
            far={1000}
          />
        </>
      )}
      {/* The grid sits under the map layer's order so entities draw over it. */}
      {grid && (
        <GridLines grid={grid} fill={scene?.background ?? DEFAULT_BACKGROUND} renderOrder={-1} />
      )}
      {/* CAM-06: double-clicking a token tweens the camera onto it, in 2D and in 3D. */}
      <FocusCamera
        mode={viewMode}
        bounds={bounds}
        canvasSize={canvasSize}
        orbitRef={director.orbitRef}
        applyRef={director.applyRef}
      />
      {/* M1-28: TokenDrag claims a press on any movable token without selecting it first, while
          empty board presses still reach the camera controls. */}
      {/* M1-21: mounted before TokenDrag so its window-capture listeners claim the press first. */}
      <RulerTool mode={mode3d ? '3d' : '2d'} readOnly={readOnly} />
      {!aoeActive && <TokenDrag readOnly={readOnly} />}
      <PickableEntities rendered={shown} scene={source} mode={mode3d ? '3d' : '2d'} grid={grid} />
      {/* MEAS-05: hovering a token with one token selected shows the token-to-token range. */}
      <RangeReadout scene={source} />
      {/* UI-TOKEN-01: a single selected token shows its quick preview card near it, 2D and 3D. */}
      <TokenPreviewCard scene={source} rendered={shown} mode={mode3d ? '3d' : '2d'} />
      {mode3d && <OcclusionFade rendered={shown} />}
      <AoEHighlights scene={source} rendered={shown} mode={mode3d ? '3d' : '2d'} />
      <SceneOverlay overlay={source?.overlay} />
      {/* M1-20 / M2-08: 2D handles, or the 3D gizmo; both are off while the AoE tool is active. */}
      {!readOnly &&
        !aoeActive &&
        (mode3d ? (
          <Suspense fallback={null}>
            <TransformGizmo3D />
          </Suspense>
        ) : (
          <TransformGizmo />
        ))}
      {!readOnly && <AoEPlacementCanvas scene={source} mode={mode3d ? '3d' : '2d'} />}
    </>
  );
}

/** Single on-demand Three scene for the active host-filtered Scene. */
export function BoardCanvas({ panelContainer }: { panelContainer: HTMLElement | null }) {
  const viewMode = useViewMode();
  const mode3d = viewMode === '3d';
  const resetToken = useStore(viewModeStore, (state) => state.resetToken);
  const campaign = useViewedCampaign();
  const isHost = useClientStore((state) => state.isHost);
  const seatId = useClientStore((state) => state.seatId);
  const readOnly = isReadOnlyViewer({ isHost, seatId, campaign });
  const scene = useMemo(() => activeRenderScene(campaign), [campaign]);
  const grid = useMemo(() => activeRenderGrid(campaign), [campaign]);
  const source = campaign?.activeSceneId ? (campaign.scenes[campaign.activeSceneId] ?? null) : null;
  // D37: depend on the numbers so unrelated state changes keep the camera where it is.
  const { width, height } = source ? resolveSceneBounds(source) : resolveSceneBounds({});
  const canvasSize = useMemo(() => ({ width, height }), [width, height]);
  const bounds = useMemo<GroundBounds>(
    () => ({ minX: 0, maxX: width, minZ: 0, maxZ: height }),
    [width, height],
  );
  const frameKey = `${source?.id ?? ''}:${String(width)}x${String(height)}`;

  return (
    <div
      aria-label="Scene board"
      tabIndex={0}
      onKeyDown={(event) => {
        handleBoardEscape(event);
        if (mode3d && event.key === 'Home') viewModeStore.getState().reset();
      }}
      className="ui-board"
    >
      <span className="ui-visually-hidden" aria-label="Current scene">
        {source?.name ?? ''}
      </span>
      <div role="toolbar" aria-label="Board controls" className="ui-toolbar ui-board-controls">
        {/* UI-TOOL-01..07: the rail lists every tool; one a seat may not use is disabled, not hidden. */}
        <ToolRail />
      </div>
      <ToolPanelDock
        campaign={campaign}
        scene={source}
        mode3d={mode3d}
        container={panelContainer}
      />
      <Canvas
        frameloop="demand"
        shadows={false}
        gl={{ antialias: true }}
        onPointerMissed={(event) => {
          if (!event.shiftKey && !event.ctrlKey && !event.metaKey)
            selectionStore.getState().clear();
        }}
      >
        <RenderDiagnostics />
        <BoardScene
          scene={scene}
          source={source}
          grid={grid}
          viewMode={viewMode}
          bounds={bounds}
          canvasSize={canvasSize}
          frameKey={frameKey}
          resetToken={resetToken}
          readOnly={readOnly}
        />
      </Canvas>
    </div>
  );
}
