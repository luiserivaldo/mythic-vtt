import {
  primitiveDimensions,
  yawFromQuaternion,
  type AssetRef,
  type Campaign,
  type Entity,
  type PrimitiveKind,
  type Scene,
} from '@mythic/shared';
import { footprintCells } from './token-footprint.js';

// TECHNICAL.md §6.4: these slots also reserve space for later prop overlays and UI.
export const RENDER_LAYERS = [
  'map',
  'props-under',
  'tokens',
  'props-over',
  'effects',
  'ui',
] as const;
export type RenderLayer = (typeof RENDER_LAYERS)[number];

export interface RenderEntity {
  id: string;
  layer: RenderLayer;
  position: readonly [number, number, number];
  sizeCells: number;
  secret: boolean;
  /** Present only for primitive entities (ENV-02). */
  shape?: RenderShape;
  /** ENV-01: present for map-layer entities with an image; `scale` is the image height in cells. */
  mapImage?: { asset: AssetRef; scale: number };
  /** Present only for token entities. */
  token?: {
    image: AssetRef | undefined;
    name: string;
    owners: readonly string[];
    entityLayer: Entity['layer'];
    perms: Entity['perms'];
    labelVisibility: 'all' | 'owner' | 'dm';
  };
}

/** ENV-02: primitive shape data, already reduced to render-ready numbers. */
export interface RenderShape {
  kind: PrimitiveKind;
  color: string;
  walkable: boolean;
  /** Bounding size in cells; the footprint centre is `position`, the base is `position[1]`. */
  width: number;
  height: number;
  depth: number;
  yaw: number;
  /** Scale as authored, for footprint building. */
  scale: { x: number; y: number; z: number };
}

export interface RenderScene {
  id: string;
  background: string;
  /** ENV-07: optional gradient top colour (3D only). */
  zenith?: string;
  entities: RenderEntity[];
}

/** GRID-02: grid Y is world Z; elevation already occupies world Y in Vec3. */
export function gridToWorld(
  x: number,
  y: number,
  elevation = 0,
): readonly [number, number, number] {
  return [x, elevation, y];
}

export function renderLayer(entity: Entity): RenderLayer {
  switch (entity.layer) {
    case 'map':
      return 'map';
    case 'props':
      return 'props-under';
    case 'tokens':
      return 'tokens';
    case 'dm':
      return entity.token ? 'tokens' : 'props-under';
    case 'effects':
      return 'effects';
  }
}

export function orderedEntities(entities: readonly RenderEntity[]): RenderEntity[] {
  const rank = (layer: RenderLayer) => RENDER_LAYERS.indexOf(layer);
  return [...entities].sort((a, b) => rank(a.layer) - rank(b.layer));
}

function renderShape(entity: Entity, shape: NonNullable<Entity['shape']>): RenderShape {
  const { width, height, depth } = primitiveDimensions(shape.kind, entity.transform.scale);
  return {
    kind: shape.kind,
    color: shape.color,
    walkable: shape.walkable,
    width,
    height,
    depth,
    yaw: yawFromQuaternion(entity.transform.rotation),
    scale: entity.transform.scale,
  };
}

/** A malformed scale falls back to one cell rather than hiding or exploding the image. */
export function mapImageScale(scale: number): number {
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

export function mapScene(scene: Scene): RenderScene {
  return {
    id: scene.id,
    background: scene.environment.background,
    ...(scene.environment.zenith ? { zenith: scene.environment.zenith } : {}),
    entities: orderedEntities(
      Object.values(scene.entities).map((entity) => ({
        id: entity.id,
        layer: renderLayer(entity),
        position: gridToWorld(
          entity.transform.position.x,
          entity.transform.position.z,
          entity.transform.position.y,
        ),
        sizeCells: footprintCells(entity.token?.sizeCells),
        secret: entity.layer === 'dm',
        ...(entity.shape ? { shape: renderShape(entity, entity.shape) } : {}),
        ...(entity.layer === 'map' && entity.image
          ? {
              mapImage: {
                asset: entity.image.asset,
                scale: mapImageScale(entity.transform.scale.x),
              },
            }
          : {}),
        ...(entity.token
          ? {
              token: {
                image: entity.token.image,
                name: entity.name,
                owners: entity.owners,
                entityLayer: entity.layer,
                perms: entity.perms,
                labelVisibility: entity.token.labelVisibility,
              },
            }
          : {}),
      })),
    ),
  };
}

/** The store contains only the host-filtered campaign for this client (PERM-03). */
export function activeRenderScene(campaign: Campaign | null): RenderScene | null {
  if (!campaign?.activeSceneId) return null;
  const scene = campaign.scenes[campaign.activeSceneId];
  return scene ? mapScene(scene) : null;
}
