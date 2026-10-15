import { useFrame } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import type { WalkableSurface } from '@mythic/shared';
import { DoubleSide, type Group } from 'three';
import type { SelectionActor } from '../tools/selection.js';
import type { RenderEntity } from './scene-model.js';
import { ElevationBadge, TokenLabel, TokenMaterial } from './TokenSprite.js';
import { TokenStatusMarkers } from './TokenStatusMarkers.js';
import { markerAnchor3d } from './status-markers.js';
import {
  billboardYaw,
  facingMarkerPosition,
  standeeDimensions,
  labelAnchor3d,
  badgeAnchor3d,
} from './token-standee.js';
import { SELECTION_COLOR } from './canvas-style.js';

const SELECTED = SELECTION_COLOR;
const FLYING_COLOR = '#7dd3fc';

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
  onDoubleClick,
  onContextMenu,
  walkables,
}: {
  entity: RenderEntity;
  color: string;
  selected: boolean;
  actor: SelectionActor;
  renderOrder: number;
  onClick: (event: ThreeEvent<MouseEvent>) => void;
  /** CAM-06: the second click of a double-click focuses the camera on this token. */
  onDoubleClick: () => void;
  /** UI-TOKEN-03: a right click opens the token's short menu (R3F's own context-menu event). */
  onContextMenu: (event: ThreeEvent<MouseEvent>) => void;
  /** The ground the badge's elevation is measured from (MV-243). */
  walkables: readonly WalkableSurface[];
}) {
  const pivot = useRef<Group>(null);
  const [x, y, z] = entity.position;
  const dims = standeeDimensions(entity.sizeCells);
  const groundPosition = useMemo(() => ({ x, z }), [x, z]);

  // Runs on every rendered frame; camera motion already triggers frames in demand mode.
  useFrame(({ camera }) => {
    const g = pivot.current;
    if (!g) return;
    g.rotation.y = billboardYaw(groundPosition, camera.position, g.rotation.y);
  });

  return (
    <group position={[x, y, z]}>
      {/* M1-34: the base turns with the token's yaw; the marker shows which way it faces. */}
      <group rotation={[0, entity.token?.yaw ?? 0, 0]}>
        <mesh
          name={entity.id}
          position={[0, dims.baseThickness / 2, 0]}
          renderOrder={renderOrder}
          onClick={onClick}
          onDoubleClick={onDoubleClick}
          onContextMenu={onContextMenu}
        >
          <cylinderGeometry args={[dims.baseRadius, dims.baseRadius, dims.baseThickness, 32]} />
          <meshStandardMaterial color={selected ? SELECTED : '#2b3643'} />
        </mesh>
        {/* Not pickable: it must never intercept clicks meant for the token. */}
        <mesh raycast={() => null} position={[...facingMarkerPosition(entity.sizeCells)]}>
          <sphereGeometry args={[dims.baseRadius * 0.12, 12, 8]} />
          <meshBasicMaterial color={SELECTED} />
        </mesh>
      </group>
      {selected && (
        // Not pickable: it must never intercept clicks meant for the token.
        <mesh raycast={() => null} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
          <ringGeometry args={[dims.baseRadius, dims.baseRadius * 1.12, 48]} />
          <meshBasicMaterial color={SELECTED} side={DoubleSide} />
        </mesh>
      )}
      {entity.token?.flying && (
        // TOK-03: flying indicator. Not pickable, like the selection ring.
        <mesh raycast={() => null} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <ringGeometry args={[dims.baseRadius * 1.2, dims.baseRadius * 1.32, 48]} />
          <meshBasicMaterial color={FLYING_COLOR} side={DoubleSide} />
        </mesh>
      )}
      <group ref={pivot} position={[0, dims.baseThickness, 0]}>
        <mesh
          name={entity.id}
          position={[0, dims.height / 2, 0]}
          renderOrder={renderOrder}
          onClick={onClick}
          onDoubleClick={onDoubleClick}
          onContextMenu={onContextMenu}
        >
          <planeGeometry args={[dims.width, dims.height]} />
          <TokenMaterial entity={entity} color={color} depth />
        </mesh>
      </group>
      <TokenLabel entity={entity} actor={actor} anchor={labelAnchor3d(entity.sizeCells)} />
      {/* F11: the height label was only drawn in 2D; it sits just above the name in 3D. */}
      <ElevationBadge
        entity={entity}
        actor={actor}
        walkables={walkables}
        anchor={badgeAnchor3d(entity.sizeCells)}
      />
      <TokenStatusMarkers entity={entity} actor={actor} anchor={markerAnchor3d(entity.sizeCells)} />
    </group>
  );
}
