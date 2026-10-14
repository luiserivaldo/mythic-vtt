import type { AssetRef, Entity, Scene } from '@mythic/shared';
import { defaultPlacementScale } from '../tools/battlemap-calibration.js';
import type { IntentSpec } from './intent-specs.js';

export interface MapRow {
  id: string;
  name: string;
  calibrated: boolean;
}

/** Map-layer entities that carry an image, in a stable order. */
export function mapRows(scene: Scene): MapRow[] {
  return Object.values(scene.entities)
    .filter((e) => e.layer === 'map' && e.image)
    .map((e) => ({ id: e.id, name: e.name, calibrated: e.image?.calibrated ?? false }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

const UNIT_ROTATION = { x: 0, y: 0, z: 0, w: 1 } as const;

/** ENV-01: place a freshly uploaded image on the map layer, centred at the origin, uncalibrated. */
export function mapPlaceIntent(args: {
  sceneId: string;
  entityId: string;
  name: string;
  hash: string;
  heightPx: number;
}): IntentSpec {
  const scale = defaultPlacementScale(args.heightPx);
  const asset: AssetRef = { source: 'local', hash: args.hash, kind: 'image', name: args.name };
  const entity: Entity = {
    id: args.entityId,
    layer: 'map',
    name: args.name,
    owners: [],
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: UNIT_ROTATION,
      scale: { x: scale, y: scale, z: scale },
    },
    image: { asset, calibrated: false },
  };
  return {
    type: 'entity.create',
    payload: { sceneId: args.sceneId, entity },
    sceneId: args.sceneId,
  };
}

/** Commits a calibration result as an entity.update; nothing is applied locally. */
export function mapCalibrateIntent(args: {
  sceneId: string;
  entity: Entity;
  scale: number;
  position: { x: number; y: number; z: number };
}): IntentSpec | null {
  if (!args.entity.image) return null;
  return {
    type: 'entity.update',
    payload: {
      sceneId: args.sceneId,
      entityId: args.entity.id,
      changes: {
        transform: {
          ...args.entity.transform,
          position: args.position,
          scale: { x: args.scale, y: args.scale, z: args.scale },
        },
        image: { ...args.entity.image, calibrated: true },
      },
    },
    sceneId: args.sceneId,
  };
}

export function fileLabel(name: string): string {
  return name.replace(/\.[^.]+$/, '').trim() || 'Battlemap';
}
