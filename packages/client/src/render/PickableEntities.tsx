import type { Scene, Seat } from '@mythic/shared';
import type { ThreeEvent } from '@react-three/fiber';
import { useStore } from 'zustand';
import { DoubleSide } from 'three';
import { useEffect } from 'react';
import { useClientStore } from '../store/react.js';
import { pickEntity, validSelection, type SelectionActor } from '../tools/selection.js';
import { selectionStore } from '../tools/selection-store.js';
import { RENDER_LAYERS, type RenderEntity, type RenderScene } from './scene-model.js';

const COLORS = {
  map: '#51637a',
  'props-under': '#8a96a5',
  tokens: '#46b6cf',
  'props-over': '#a8b5c3',
  effects: '#f0ae55',
  ui: '#ffffff',
} as const;

function actorFor(seatId: string | null, seats: SceneSelectionSeats): SelectionActor {
  if (seatId === null) return { kind: 'host' };
  const seat = seats[seatId];
  return seat ? { kind: 'seat', seat } : { kind: 'spectator' };
}

type SceneSelectionSeats = Record<string, Seat>;

export function PickableEntities({
  rendered,
  scene,
  additiveMode,
}: {
  rendered: RenderScene | null;
  scene: Scene | null;
  additiveMode: boolean;
}) {
  const seatId = useClientStore((state) => state.seatId);
  const seats = useClientStore((state) => state.campaign?.seats ?? {});
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

  return RENDER_LAYERS.map((layer, order) => (
    <group key={layer} name={layer}>
      {rendered?.entities
        .filter((entity) => entity.layer === layer)
        .map((entity: RenderEntity) => (
          <mesh
            key={entity.id}
            name={entity.id}
            position={[...entity.position]}
            rotation={[-Math.PI / 2, 0, 0]}
            renderOrder={order}
            onClick={onClick}
          >
            <planeGeometry args={[entity.sizeCells, entity.sizeCells]} />
            <meshBasicMaterial
              color={
                selected.includes(entity.id)
                  ? '#ffe066'
                  : entity.secret
                    ? '#a577ce'
                    : COLORS[entity.layer]
              }
              side={DoubleSide}
              depthTest={false}
              depthWrite={false}
            />
          </mesh>
        ))}
    </group>
  ));
}
