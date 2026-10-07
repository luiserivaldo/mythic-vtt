import { useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect } from 'react';
import { useStore } from 'zustand';
import { DoubleSide } from 'three';
import { assetUrl } from '../assets/asset-url.js';
import { worldToLocal } from '../tools/battlemap-calibration.js';
import { calibrationStore } from '../tools/battlemap-store.js';
import { useMapTexture } from './use-texture.js';
import type { RenderEntity } from './scene-model.js';
import { SELECTION_COLOR } from './canvas-style.js';

/** Host origin for assets. '' = same origin (dev server proxies `/assets` to the host). */
const ASSET_BASE_URL = '';
const MARKER_RADIUS = 0.15;

/**
 * ENV-01: a battlemap image lying on the XZ plane, `scale` cells tall and `scale * aspect` wide,
 * centred on the entity position. While calibrating this entity, clicks add calibration points
 * instead of selecting. Markers are plain meshes (no world-space text).
 */
export function MapImageMesh({
  entity,
  mapImage,
  renderOrder,
  selected,
  onPick,
}: {
  entity: RenderEntity;
  mapImage: NonNullable<RenderEntity['mapImage']>;
  renderOrder: number;
  selected: boolean;
  onPick: (event: ThreeEvent<MouseEvent>) => void;
}) {
  const invalidate = useThree((state) => state.invalidate);
  const entry = useMapTexture(assetUrl(ASSET_BASE_URL, mapImage.asset));
  const calibrating = useStore(calibrationStore, (s) => s.entityId === entity.id);
  const points = useStore(calibrationStore, (s) => s.points);
  useEffect(() => {
    invalidate();
  }, [points, calibrating, invalidate]);

  const image =
    entry.status === 'ready' ? (entry.texture.image as { width: number; height: number }) : null;
  const aspect = image && image.width > 0 && image.height > 0 ? image.width / image.height : 1;
  const scale = mapImage.scale;
  const [px, py, pz] = entity.position;

  function onClick(event: ThreeEvent<MouseEvent>) {
    if (!calibrating) {
      onPick(event);
      return;
    }
    event.stopPropagation();
    calibrationStore
      .getState()
      .addPoint(entity.id, worldToLocal(event.point, { x: px, y: py, z: pz }, scale));
  }

  return (
    <mesh
      name={entity.id}
      position={[px, py, pz]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={renderOrder}
      onClick={onClick}
    >
      <planeGeometry args={[scale * aspect, scale]} />
      <meshBasicMaterial
        key={entry.status === 'ready' ? 'textured' : 'flat'}
        color={entry.status === 'ready' ? '#ffffff' : selected ? SELECTION_COLOR : '#51637a'}
        {...(entry.status === 'ready' ? { map: entry.texture } : {})}
        side={DoubleSide}
        depthTest={false}
        depthWrite={false}
      />
      {calibrating &&
        points.map((p, i) => (
          // The mesh is rotated -90 degrees about X, so local y is world -z.
          <mesh
            key={i}
            raycast={() => null}
            position={[p.x * scale, -p.z * scale, 0.01]}
            renderOrder={renderOrder + 1}
          >
            <circleGeometry args={[MARKER_RADIUS, 24]} />
            <meshBasicMaterial
              color={i === 0 ? '#ff5a5f' : '#3ddc97'}
              depthTest={false}
              depthWrite={false}
            />
          </mesh>
        ))}
    </mesh>
  );
}
