import { useMemo } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { DoubleSide } from 'three';
import {
  footprintFill,
  footprintOutline,
  safeColor,
  shapeFootprint,
  surfaceDrawHeight,
  unitGeometry,
} from './primitive-geometry.js';
import type { RenderEntity, RenderShape } from './scene-model.js';
import { SELECTION_COLOR } from './canvas-style.js';

export type RenderMode = '2d' | '3d';

const SELECTED = SELECTION_COLOR;
const SECRET = '#a577ce';

/**
 * ENV-02 primitive. 2D: top-down footprint fill plus outline (readable, and the fill is the
 * pickable surface). 3D: the real mesh. The mesh is named with the entity id for picking.
 */
export function PrimitiveMesh({
  entity,
  shape,
  mode,
  selected,
  renderOrder,
  onClick,
}: {
  entity: RenderEntity;
  shape: RenderShape;
  mode: RenderMode;
  selected: boolean;
  renderOrder: number;
  onClick: (event: ThreeEvent<MouseEvent>) => void;
}) {
  const [x, y, z] = entity.position;
  const color = safeColor(shape.color);
  const outline = selected ? SELECTED : entity.secret ? SECRET : '#0b1118';

  if (mode === '3d') {
    return (
      <mesh
        name={entity.id}
        position={[x, y, z]}
        rotation={[0, shape.yaw, 0]}
        scale={[shape.width, shape.height, shape.depth]}
        geometry={unitGeometry(shape.kind)}
        renderOrder={renderOrder}
        onClick={onClick}
      >
        <meshStandardMaterial
          color={color}
          side={DoubleSide}
          emissive={selected ? SELECTED : '#000000'}
          emissiveIntensity={selected ? 0.35 : 0}
        />
      </mesh>
    );
  }

  return (
    <Footprint2D
      entity={entity}
      shape={shape}
      color={color}
      outline={outline}
      renderOrder={renderOrder}
      onClick={onClick}
    />
  );
}

function Footprint2D({
  entity,
  shape,
  color,
  outline,
  renderOrder,
  onClick,
}: {
  entity: RenderEntity;
  shape: RenderShape;
  color: string;
  outline: string;
  renderOrder: number;
  onClick: (event: ThreeEvent<MouseEvent>) => void;
}) {
  const { kind, width, depth, yaw, scale } = shape;
  const geometries = useMemo(() => {
    const points = shapeFootprint({ ...shape, kind, width, depth, yaw, scale });
    return { fill: footprintFill(points), line: footprintOutline(points) };
    // The shape object is rebuilt on every scene mapping; depend on its geometric inputs only.
  }, [kind, width, depth, yaw, scale.x, scale.y, scale.z]);
  const [x, y, z] = entity.position;
  const drawY = y + surfaceDrawHeight(shape);

  return (
    <group position={[x, drawY, z]}>
      <mesh name={entity.id} geometry={geometries.fill} renderOrder={renderOrder} onClick={onClick}>
        <meshBasicMaterial
          color={color}
          side={DoubleSide}
          transparent={!shape.walkable}
          opacity={shape.walkable ? 1 : 0.6}
        />
      </mesh>
      {/* Outline is cosmetic; excluded from raycasting so picking stays on the named fill. */}
      <lineLoop
        position={[0, 0.002, 0]}
        geometry={geometries.line}
        renderOrder={renderOrder}
        raycast={() => null}
      >
        <lineBasicMaterial color={outline} />
      </lineLoop>
    </group>
  );
}
