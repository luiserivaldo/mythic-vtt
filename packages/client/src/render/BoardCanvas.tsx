import { Canvas, useThree } from '@react-three/fiber';
import { resolveSceneBounds, type Scene, type SceneBounds } from '@mythic/shared';
import { OrthographicCamera } from '@react-three/drei';
import { useEffect, useMemo, useState } from 'react';
import { useClientStore } from '../store/react.js';
import { activeRenderScene, type RenderScene } from './scene-model.js';
import { PickableEntities } from './PickableEntities.js';
import { selectionStore } from '../tools/selection-store.js';
import { GridLines } from './GridLines.js';
import { activeRenderGrid, type RenderGrid } from './grid-model.js';
import { PanZoomControls } from './PanZoomControls.js';
import { TransformGizmo } from './TransformGizmo.js';
import { TransformPanel } from '../ui/TransformPanel.js';
import { OrbitControls3D } from './OrbitControls3D.js';
import { Skybox } from './Skybox.js';
import { DEFAULT_BACKGROUND, resolveBackground } from './skybox-model.js';
import { outsideColor } from './canvas-style.js';
import type { GroundBounds } from './camera-3d.js';
import { useViewMode, type ViewMode } from './view-mode-store.js';
import { useViewDirector } from './use-view-director.js';
import { ViewToggle } from './ViewToggle.js';

function BoardScene({
  scene,
  source,
  grid,
  additiveMode,
  viewMode,
  bounds,
  canvasSize,
  frameKey,
  resetToken,
}: {
  scene: RenderScene | null;
  source: Scene | null;
  grid: RenderGrid | null;
  additiveMode: boolean;
  viewMode: ViewMode;
  bounds: GroundBounds | null;
  canvasSize: SceneBounds;
  frameKey: string;
  resetToken: number;
}) {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    invalidate();
  }, [scene, invalidate]);
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
      {mode3d && backdrop.zenith && <Skybox spec={backdrop} />}
      {mode3d ? (
        <OrbitControls3D
          bounds={bounds}
          resetToken={resetToken}
          orbitRef={director.orbitRef}
          applyRef={director.applyRef}
          keepInitialOrbit={director.keepInitialOrbit}
        />
      ) : (
        <>
          <PanZoomControls bounds={canvasSize} frameKey={frameKey} />
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
      {/* TODO(M1-18): PanZoomControls pans on any left-drag past a threshold, even one that
          starts on a selectable token. Token drag will own that arbitration. Plain clicks
          reach picking because only a drag-ending click is swallowed. */}
      <PickableEntities
        rendered={scene}
        scene={source}
        additiveMode={additiveMode}
        mode={mode3d ? '3d' : '2d'}
      />
      {/* M1-20: 2D transform handles; the 3D gizmo is M2-08. */}
      {!mode3d && <TransformGizmo />}
    </>
  );
}

/** Single on-demand Three scene for the active host-filtered Scene. */
export function BoardCanvas() {
  const viewMode = useViewMode();
  const mode3d = viewMode === '3d';
  const [resetToken, setResetToken] = useState(0);
  const [additiveMode, setAdditiveMode] = useState(false);
  const campaign = useClientStore((state) => state.campaign);
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
        if (event.key === 'Escape') selectionStore.getState().clear();
        if (mode3d && event.key === 'Home') setResetToken((n) => n + 1);
      }}
      style={{ width: '100%', height: 'min(70vh, 720px)', position: 'relative' }}
    >
      <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 1 }}>
        <button
          type="button"
          aria-pressed={additiveMode}
          onClick={() => {
            setAdditiveMode((value) => !value);
          }}
        >
          Multi-select
        </button>
        <button
          type="button"
          onClick={() => {
            selectionStore.getState().clear();
          }}
        >
          Clear selection
        </button>
        <ViewToggle />
        {mode3d && (
          <button
            type="button"
            onClick={() => {
              setResetToken((n) => n + 1);
            }}
          >
            Reset view
          </button>
        )}
      </div>
      {!mode3d && <TransformPanel />}
      <Canvas
        frameloop="demand"
        shadows={false}
        gl={{ antialias: true }}
        onPointerMissed={(event) => {
          if (!additiveMode && !event.shiftKey && !event.ctrlKey && !event.metaKey)
            selectionStore.getState().clear();
        }}
      >
        <BoardScene
          scene={scene}
          source={source}
          grid={grid}
          additiveMode={additiveMode}
          viewMode={viewMode}
          bounds={bounds}
          canvasSize={canvasSize}
          frameKey={frameKey}
          resetToken={resetToken}
        />
      </Canvas>
    </div>
  );
}
