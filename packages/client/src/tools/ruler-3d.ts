import {
  dropElevation,
  surfaceHeightAt,
  walkableFromEntity,
  yawFromQuaternion,
  type Scene,
  type Vec3,
  type WalkableSurface,
} from '@mythic/shared';
import { prepareRulerPoint } from './ruler.js';

/** Visible walkable geometry is already audience-filtered in the client's scene (PERM-03). */
export function rulerWalkables(scene: Scene): readonly WalkableSurface[] {
  return Object.values(scene.entities).flatMap((entity) => {
    const surface = walkableFromEntity(entity);
    return surface ? [surface] : [];
  });
}

/**
 * MEAS-02 pick resolution. Tokens measure from their feet/position. Other ray hits snap in X/Z,
 * then use the shared surface profile so wedges and curved primitives report their real elevation.
 */
export function prepareRulerPoint3d(raw: Vec3, scene: Scene, entityId?: string): Vec3 {
  const entity = entityId ? scene.entities[entityId] : undefined;
  if (entity?.token) return { ...entity.transform.position };

  const horizontal = prepareRulerPoint(raw, scene);
  // Measurement can target any primitive surface, even when it is not walkable for token drops.
  const targetSurface: WalkableSurface | undefined = entity?.shape
    ? {
        kind: entity.shape.kind,
        position: entity.transform.position,
        scale: entity.transform.scale,
        yaw: yawFromQuaternion(entity.transform.rotation),
      }
    : undefined;
  const surfaces = targetSurface ? [targetSurface] : rulerWalkables(scene);
  const highest = surfaceHeightAt(horizontal.x, horizontal.z, surfaces);
  const dropped = dropElevation({ x: horizontal.x, y: raw.y, z: horizontal.z }, surfaces);
  // A top-face hit should choose the surface reached by the ray. The highest profile remains a
  // stable fallback for numerical misses after X/Z snapping.
  const y = dropped > 0 || raw.y <= 0 ? dropped : highest;
  return { ...horizontal, y };
}

/** Corner used by the 3D right-angle guide: horizontal first, then vertical. */
export function rulerGuideCorner(from: Vec3, to: Vec3): Vec3 {
  return { x: to.x, y: from.y, z: to.z };
}
