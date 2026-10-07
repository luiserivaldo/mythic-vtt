import { useFrame } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { useRef } from 'react';
import { DoubleSide, type Group } from 'three';
import type { SelectionActor } from '../tools/selection.js';
import type { RenderEntity } from './scene-model.js';
import { TokenLabel, TokenMaterial } from './TokenSprite.js';
import { billboardYaw, standeeDimensions, labelAnchor3d } from './token-standee.js';
import { SELECTION_COLOR } from './canvas-style.js';

const SELECTED = SELECTION_COLOR;

/**
 * M2-06 / TOK-03: a 3D token. Base disc at `position` (feet, y = elevation) plus an
 * upright image quad that rotates about Y only to face the camera, so it never flips or mirrors
 * (CAM-04). Both meshes are named with the entity id so picking resolves either one. Works for
 * tokens without an image: the quad uses the flat placeholder colour.
 */
export function TokenStandee({
  entity,
  color,
  selected,
  actor,
  renderOrder,
  onClick,
}: {
  entity: RenderEntity;
  color: string;
  selected: boolean;
  actor: SelectionActor;
  renderOrder: number;
  onClick: (event: ThreeEvent<MouseEvent>) => void;
}) {
  const pivot = useRef<Group>(null);
  const [x, y, z] = entity.position;
  const dims = standeeDimensions(entity.sizeCells);

  // Runs on every rendered frame; camera motion already triggers frames in demand mode.
  useFrame(({ camera }) => {
    const g = pivot.current;
    if (!g) return;
    g.rotation.y = billboardYaw({ x, z }, camera.position, g.rotation.y);
  });

  return (
    <group position={[x, y, z]}>
      <mesh
        name={entity.id}
        position={[0, dims.baseThickness / 2, 0]}
        renderOrder={renderOrder}
        onClick={onClick}
      >
        <cylinderGeometry args={[dims.baseRadius, dims.baseRadius, dims.baseThickness, 32]} />
        <meshStandardMaterial color={selected ? SELECTED : '#2b3643'} />
      </mesh>
      {selected && (
        // Not pickable: it must never intercept clicks meant for the token.
        <mesh raycast={() => null} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
          <ringGeometry args={[dims.baseRadius, dims.baseRadius * 1.12, 48]} />
          <meshBasicMaterial color={SELECTED} side={DoubleSide} />
        </mesh>
      )}
      <group ref={pivot} position={[0, dims.baseThickness, 0]}>
        <mesh
          name={entity.id}
          position={[0, dims.height / 2, 0]}
          renderOrder={renderOrder}
          onClick={onClick}
        >
          <planeGeometry args={[dims.width, dims.height]} />
          <TokenMaterial entity={entity} color={color} depth />
        </mesh>
      </group>
      <TokenLabel entity={entity} actor={actor} anchor={labelAnchor3d(entity.sizeCells)} />
    </group>
  );
}
