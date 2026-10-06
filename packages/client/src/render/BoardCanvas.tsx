import { Canvas, useThree } from '@react-three/fiber';
import type { Scene } from '@mythic/shared';
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
import type { GroundBounds } from './camera-3d.js';

function BoardScene({
  scene,
  source,
  grid,
  additiveMode,
  mode3d,
  bounds,
  resetToken,
}: {
  scene: RenderScene | null;
  source: Scene | null;
  grid: RenderGrid | null;
  additiveMode: boolean;
  mode3d: boolean;
  bounds: GroundBounds | null;
  resetToken: number;
}) {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    invalidate();
  }, [scene, invalidate]);

  const backdrop = useMemo(
    () => resolveBackground(scene?.background, scene?.zenith),
    [scene?.background, scene?.zenith],
  );
  return (
    <>
      <color attach="background" args={[scene?.background ?? DEFAULT_BACKGROUND]} />
      {mode3d && backdrop.zenith && <Skybox spec={backdrop} />}
      {mode3d ? (
        <OrbitControls3D bounds={bounds} resetToken={resetToken} />
      ) : (
        <>
          <PanZoomControls />
          <OrthographicCamera
            makeDefault
            position={[0, 20, 0]}
            up={[0, 0, -1]}
            rotation={[-Math.PI / 2, 0, 0]}
            zoom={48}
            near={0.1}
            far={1000}
          />
        </>
      )}
      {/* The grid sits under the map layer's order so entities draw over it. */}
      {grid && <GridLines grid={grid} renderOrder={-1} />}
      {/* TODO(M1-18): PanZoomControls pans on any left-drag past a threshold, even one that
          starts on a selectable token. Token drag will own that arbitration. Plain clicks
          reach picking because only a drag-ending click is swallowed. */}
      <PickableEntities rendered={scene} scene={source} additiveMode={additiveMode} />
      {/* M1-20: 2D transform handles; the 3D gizmo is M2-08. */}
      {!mode3d && <TransformGizmo />}
    </>
  );
}

/** Ground extent of the scene's entities, for framing the 3D default view. */
function sceneBounds(scene: RenderScene | null): GroundBounds | null {
  if (!scene || scene.entities.length === 0) return null;
  let b: GroundBounds | null = null;
  for (const e of scene.entities) {
    const [x, , z] = e.position;
    const r = e.sizeCells / 2;
    b = b
      ? {
          minX: Math.min(b.minX, x - r),
          maxX: Math.max(b.maxX, x + r),
          minZ: Math.min(b.minZ, z - r),
          maxZ: Math.max(b.maxZ, z + r),
        }
      : { minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r };
  }
  return b;
}

/** Single on-demand Three scene for the active host-filtered Scene. */
export function BoardCanvas({ mode3d = false }: { mode3d?: boolean } = {}) {
  const [resetToken, setResetToken] = useState(0);
  const [additiveMode, setAdditiveMode] = useState(false);
  const campaign = useClientStore((state) => state.campaign);
  const scene = useMemo(() => activeRenderScene(campaign), [campaign]);
  const bounds = useMemo(() => sceneBounds(scene), [scene]);
  const grid = useMemo(() => activeRenderGrid(campaign), [campaign]);
  const source = campaign?.activeSceneId ? (campaign.scenes[campaign.activeSceneId] ?? null) : null;

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
          mode3d={mode3d}
          bounds={bounds}
          resetToken={resetToken}
        />
      </Canvas>
    </div>
  );
}
