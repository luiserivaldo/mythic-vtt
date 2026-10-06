import { Canvas, useThree } from '@react-three/fiber';
import { OrthographicCamera } from '@react-three/drei';
import { useEffect, useMemo } from 'react';
import { DoubleSide } from 'three';
import { useClientStore } from '../store/react.js';
import {
  activeRenderScene,
  RENDER_LAYERS,
  type RenderEntity,
  type RenderScene,
} from './scene-model.js';

const COLORS = {
  map: '#51637a',
  'props-under': '#8a96a5',
  tokens: '#46b6cf',
  'props-over': '#a8b5c3',
  effects: '#f0ae55',
  ui: '#ffffff',
} as const;

function FoundationMarker({ entity, order }: { entity: RenderEntity; order: number }) {
  return (
    <mesh position={[...entity.position]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={order}>
      <planeGeometry args={[entity.sizeCells, entity.sizeCells]} />
      <meshBasicMaterial
        color={entity.secret ? '#a577ce' : COLORS[entity.layer]}
        side={DoubleSide}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  );
}

function BoardScene({ scene }: { scene: RenderScene | null }) {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    invalidate();
  }, [scene, invalidate]);

  return (
    <>
      <color attach="background" args={[scene?.background ?? '#101923']} />
      <OrthographicCamera
        makeDefault
        position={[0, 20, 0]}
        up={[0, 0, -1]}
        rotation={[-Math.PI / 2, 0, 0]}
        zoom={48}
        near={0.1}
        far={1000}
      />
      {scene &&
        RENDER_LAYERS.map((layer, order) => (
          <group key={layer} name={layer}>
            {scene.entities
              .filter((entity) => entity.layer === layer)
              .map((entity) => (
                <FoundationMarker key={entity.id} entity={entity} order={order} />
              ))}
          </group>
        ))}
    </>
  );
}

/** Single on-demand Three scene for the active host-filtered Scene. */
export function BoardCanvas() {
  const campaign = useClientStore((state) => state.campaign);
  const scene = useMemo(() => activeRenderScene(campaign), [campaign]);

  return (
    <div aria-label="Scene board" style={{ width: '100%', height: 'min(70vh, 720px)' }}>
      <Canvas frameloop="demand" shadows={false} gl={{ antialias: true }}>
        <BoardScene scene={scene} />
      </Canvas>
    </div>
  );
}
