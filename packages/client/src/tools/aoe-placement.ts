import {
  snapToGrid,
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
const COLOR = '#9f1239';

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

/**
 * MEAS-03 / D25 / M3-10: grid snapping affects the origin and the yaw, never the exact platform
 * height. The origin goes through the shared `snapToGrid` helper, so an AoE lands on the same
 * cell centre a token or prop does; non-square grids have no snap (as for tokens).
 */
export function placeDraft(
  draft: AoEDraft,
  scene: Scene,
): { shape: AoEShape; transform: Transform } {
  const snap = scene.grid.snap && scene.grid.type === 'square';
  const snapped = snap ? snapToGrid({ x: draft.x, y: 0, z: draft.z }, scene.grid) : draft;
  const x = snapped.x;
  const z = snapped.z;
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

/** The largest size `validAoEDraft` accepts, in cells. */
export const MAX_AOE_SIZE_CELLS = 100;

/**
 * UI-MEAS-04 / Q28: every shape is sized by dragging. `distance` is how far the pointer is from
 * the origin, in cells. Spheres, cylinders and cones measure their radius or length along the
 * drag; a cube is centred on its origin, so the drag reaches its edge and the side is twice that.
 * With snapping on, the size rounds to whole cells (never below one); off, it stays exact. The
 * result is clamped to what the host accepts.
 */
export function dragSize(kind: AoEKind, distance: number, snap: boolean): number {
  const raw = Number.isFinite(distance) ? Math.abs(distance) * (kind === 'cube' ? 2 : 1) : 0;
  const sized = snap ? Math.max(1, Math.round(raw)) : Math.max(0.01, raw);
  return Math.min(MAX_AOE_SIZE_CELLS, sized);
}

/** Whether the size is a radius, a length or a side, for the live readout (UI-MEAS-04). */
export function sizeNoun(kind: AoEKind): 'radius' | 'length' | 'side' {
  if (kind === 'cube') return 'side';
  return kind === 'cone' || kind === 'line' ? 'length' : 'radius';
}

export function validAoEDraft(draft: AoEDraft, grid: Grid): boolean {
  return (
    draft.size > 0 &&
    draft.size <= MAX_AOE_SIZE_CELLS &&
    Number.isFinite(draft.size) &&
    Number.isFinite(draft.degrees) &&
    Number.isFinite(draft.x) &&
    Number.isFinite(draft.z) &&
    (draft.elevation === null || Number.isFinite(draft.elevation)) &&
    grid.unitsPerCell > 0
  );
}

/**
 * MEAS-03 / M3-10 (PT2-21): the panel is a readout in scene units and a placement draft holds raw
 * world coordinates (the pointer point, or a free position typed while snap is off), for example
 * 32.744568807685766 cells. Rounding to whole scene units here covers both that case and float
 * noise from unsnapped sizes and angles; the stored values stay exact. Non-finite input passes
 * through unchanged: `validAoEDraft` is what rejects it, so a NaN field stays visibly invalid
 * instead of turning into 0.
 */
export function sceneUnitReadout(cells: number, grid: Pick<Grid, 'unitsPerCell'>): number {
  const units = Math.round(cells * grid.unitsPerCell);
  return Object.is(units, -0) ? 0 : units;
}

/** The yaw field is degrees, not scene units: one decimal is enough to aim any shape. */
export function degreesReadout(degrees: number): number {
  const rounded = Number.isFinite(degrees) ? Number(degrees.toFixed(1)) : degrees;
  return Object.is(rounded, -0) ? 0 : rounded;
}
