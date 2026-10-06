import {
  surfaceHeightAt,
  walkableFromEntity,
  yawFromQuaternion,
  type AoEEntity,
  type AoEShape,
  type Grid,
  type Scene,
  type Transform,
} from '@mythic/shared';
import { quaternionFromYaw } from './transform-gizmo.js';

export type AoEKind = AoEShape['kind'];
export interface AoEDraft {
  kind: AoEKind;
  size: number;
  degrees: number;
  elevation: number | null;
  x: number;
  z: number;
}
export const DEFAULT_AOE_DRAFT: AoEDraft = {
  kind: 'sphere',
  size: 2,
  degrees: 0,
  elevation: null,
  x: 5,
  z: 5,
};
const COLOR = '#ff7744';

export function aoeShape(kind: AoEKind, size: number): AoEShape {
  switch (kind) {
    case 'sphere':
      return { kind, radius: size, color: COLOR };
    case 'cylinder':
      return { kind, radius: size, height: size, color: COLOR };
    case 'cone':
      return { kind, radius: size, length: size, color: COLOR };
    case 'cube':
      return { kind, size, color: COLOR };
    case 'line':
      return { kind, length: size, width: 1, height: 1, color: COLOR };
  }
}

export function primarySize(shape: AoEShape): number {
  switch (shape.kind) {
    case 'sphere':
    case 'cylinder':
    case 'cone':
      return shape.radius;
    case 'cube':
      return shape.size;
    case 'line':
      return shape.length;
  }
}

/** MEAS-03 / D25: grid snapping affects the origin and yaw, never the exact platform height. */
export function placeDraft(
  draft: AoEDraft,
  scene: Scene,
): { shape: AoEShape; transform: Transform } {
  const snap = scene.grid.snap && scene.grid.type === 'square';
  const x = snap ? Math.round(draft.x) : draft.x;
  const z = snap ? Math.round(draft.z) : draft.z;
  const degrees = snap ? Math.round(draft.degrees / 15) * 15 : draft.degrees;
  const walkables = Object.values(scene.entities).flatMap((entity) => {
    const surface = walkableFromEntity(entity);
    return surface ? [surface] : [];
  });
  const y = draft.elevation ?? surfaceHeightAt(x, z, walkables);
  return {
    shape: aoeShape(draft.kind, draft.size),
    transform: {
      position: { x, y, z },
      rotation: quaternionFromYaw((degrees * Math.PI) / 180),
      scale: { x: 1, y: 1, z: 1 },
    },
  };
}

export function draftFromAoE(entity: AoEEntity): AoEDraft {
  return {
    kind: entity.aoe.kind,
    size: primarySize(entity.aoe),
    degrees: (yawFromQuaternion(entity.transform.rotation) * 180) / Math.PI,
    elevation: entity.transform.position.y,
    x: entity.transform.position.x,
    z: entity.transform.position.z,
  };
}

export function aoePlacePayload(sceneId: string, id: string, draft: AoEDraft, scene: Scene) {
  const { shape, transform } = placeDraft(draft, scene);
  return {
    sceneId,
    entity: {
      id,
      layer: 'effects' as const,
      name: `${draft.kind} AoE`,
      owners: [],
      transform,
      aoe: shape,
    },
  };
}

export function aoeUpdatePayload(
  sceneId: string,
  entity: AoEEntity,
  draft: AoEDraft,
  scene: Scene,
) {
  const { shape, transform } = placeDraft(draft, scene);
  return {
    sceneId,
    entityId: entity.id,
    changes: { transform, aoe: { ...shape, color: entity.aoe.color } },
  };
}

export function validAoEDraft(draft: AoEDraft, grid: Grid): boolean {
  return (
    draft.size > 0 &&
    draft.size <= 100 &&
    Number.isFinite(draft.size) &&
    Number.isFinite(draft.degrees) &&
    Number.isFinite(draft.x) &&
    Number.isFinite(draft.z) &&
    (draft.elevation === null || Number.isFinite(draft.elevation)) &&
    grid.unitsPerCell > 0
  );
}
