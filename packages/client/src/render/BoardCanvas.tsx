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

function BoardScene({
  scene,
  source,
  grid,
  additiveMode,
}: {
  scene: RenderScene | null;
  source: Scene | null;
  grid: RenderGrid | null;
  additiveMode: boolean;
}) {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    invalidate();
  }, [scene, invalidate]);

  return (
    <>
      <color attach="background" args={[scene?.background ?? '#101923']} />
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
      {/* The grid sits under the map layer's order so entities draw over it. */}
      {grid && <GridLines grid={grid} renderOrder={-1} />}
      {/* TODO(M1-18): PanZoomControls pans on any left-drag past a threshold, even one that
          starts on a selectable token. Token drag will own that arbitration. Plain clicks
          reach picking because only a drag-ending click is swallowed. */}
      <PickableEntities rendered={scene} scene={source} additiveMode={additiveMode} />
    </>
  );
}

/** Single on-demand Three scene for the active host-filtered Scene. */
export function BoardCanvas() {
  const [additiveMode, setAdditiveMode] = useState(false);
  const campaign = useClientStore((state) => state.campaign);
  const scene = useMemo(() => activeRenderScene(campaign), [campaign]);
  const grid = useMemo(() => activeRenderGrid(campaign), [campaign]);
  const source = campaign?.activeSceneId ? (campaign.scenes[campaign.activeSceneId] ?? null) : null;

  return (
    <div
      aria-label="Scene board"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Escape') selectionStore.getState().clear();
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
      </div>
      <Canvas
        frameloop="demand"
        shadows={false}
        gl={{ antialias: true }}
        onPointerMissed={(event) => {
          if (!additiveMode && !event.shiftKey && !event.ctrlKey && !event.metaKey)
            selectionStore.getState().clear();
        }}
      >
        <BoardScene scene={scene} source={source} grid={grid} additiveMode={additiveMode} />
      </Canvas>
    </div>
  );
}
