import { useMemo } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { DoubleSide, type Texture } from 'three';
import { assetUrl } from '../assets/asset-url.js';
import {
  footprintFill,
  footprintOutline,
  safeColor,
  shapeFootprint,
  surfaceDrawHeight,
  textureTiling,
  unitGeometry,
} from './primitive-geometry.js';
import type { RenderEntity, RenderShape } from './scene-model.js';
import { SELECTION_COLOR } from './canvas-style.js';
import { useTiledTexture } from './use-texture.js';

export type RenderMode = '2d' | '3d';

const SELECTED = SELECTION_COLOR;
const SECRET = '#a577ce';
/** Host origin for assets. '' = same origin (dev server proxies `/assets` to the host). */
const ASSET_BASE_URL = '';
/** ENV-05: the 2D footprint's UVs are already cell coordinates, so it needs no texture repeat. */
const ONE_TILE = 1;

/**
 * ENV-02 primitive. 2D: top-down footprint fill plus outline (readable, and the fill is the
 * pickable surface). 3D: the real mesh. The mesh is named with the entity id for picking.
 * ENV-05: an uploaded texture tiles once per cell across the faces, in both modes; the author's
 * size in cells is the tiling control. Without a texture the solid colour is drawn as before.
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
  const tiling = textureTiling(shape);
  const threeD = mode === '3d';
  const texture = useTiledTexture(
    assetUrl(ASSET_BASE_URL, shape.texture),
    threeD ? tiling.x : ONE_TILE,
    threeD ? tiling.y : ONE_TILE,
  );

  if (threeD) {
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
        {/* CAM-05 owns opacity, transparency and depthWrite temporarily; keep those out of
            JSX so a colour/selection rerender does not overwrite an active fade. */}
        <meshStandardMaterial
          // A texture replaces the solid colour (ENV-05); the key makes three compile the map.
          key={texture ? 'textured' : 'flat'}
          color={texture ? '#ffffff' : color}
          {...(texture ? { map: texture } : {})}
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
      texture={texture}
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
  texture,
  renderOrder,
  onClick,
}: {
  entity: RenderEntity;
  shape: RenderShape;
  color: string;
  outline: string;
  texture: Texture | null;
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
          key={texture ? 'textured' : 'flat'}
          color={texture ? '#ffffff' : color}
          {...(texture ? { map: texture } : {})}
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
