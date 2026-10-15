import {
  primitiveDimensions,
  yawFromQuaternion,
  AoEShape,
  type AssetRef,
  type Campaign,
  type Entity,
  type LayerId,
  type PrimitiveKind,
  type Scene,
  type TokenStatusMarker,
} from '@mythic/shared';
import { footprintCells } from './token-footprint.js';
import type { Volume } from './aoe-geometry.js';

// These slots also reserve space for later prop overlays and UI.
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
  /** UI-LAY-01 (MV-244): set by the view filter on objects off the viewer's active layer. */
  dimmed?: boolean;
  rings?: { radius: number; color: string }[];
  aoe?: Volume | undefined;
  /** Present only for primitive entities (ENV-02). */
  shape?: RenderShape;
  /** ENV-01: present for map-layer entities with an image; `scale` is the image height in cells. */
  mapImage?: { asset: AssetRef; scale: number };
  /** Present only for token entities. */
  token?: {
    image: AssetRef | undefined;
    /** D38: placeholder colour for a token without an image. */
    color?: string;
    name: string;
    owners: readonly string[];
    entityLayer: Entity['layer'];
    perms: Entity['perms'];
    labelVisibility: 'all' | 'owner' | 'dm';
    /** M1-34: token image Y-rotation in radians, from transform.rotation. */
    yaw: number;
    /** TOK-03: height is locked; drawn with a flying indicator. */
    flying?: boolean;
    /** TOK-06: conditions and custom markers drawn over the token. Absent when the host stripped
     * them for this viewer (PERM-03), never an empty list. */
    statusMarkers?: readonly TokenStatusMarker[];
  };
}

/** ENV-02: primitive shape data, already reduced to render-ready numbers. */
export interface RenderShape {
  kind: PrimitiveKind;
  color: string;
  /** ENV-05: uploaded image tiled once per cell across the faces; the colour is the fallback. */
  texture?: AssetRef;
  walkable: boolean;
  /** GRID-05: show the scene grid on the walkable top in 3D. */
  showGridOnTop: boolean;
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
  /** ENV-07: optional uploaded image used as the 3D skybox; the colour/gradient is the fallback. */
  skybox?: AssetRef;
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

/** The draw band a layer's plain entities use (§6.4); DM primitives draw with props. */
export function layerRenderBand(layer: LayerId): RenderLayer {
  switch (layer) {
    case 'map':
      return 'map';
    case 'props':
      return 'props-under';
    case 'tokens':
      return 'tokens';
    case 'dm':
      return 'props-under';
    case 'effects':
      return 'effects';
  }
}

export function renderLayer(entity: Entity): RenderLayer {
  // TOK-02: component determines the visual surface. A token authored on map/props still needs
  // to be visible and pickable above primitive footprints in the 2D table.
  if (entity.token) return 'tokens';
  return layerRenderBand(entity.layer);
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
    ...(shape.texture ? { texture: shape.texture } : {}),
    walkable: shape.walkable,
    showGridOnTop: shape.showGridOnTop === true,
    width,
    height,
    depth,
    yaw: yawFromQuaternion(entity.transform.rotation),
    scale: entity.transform.scale,
  };
}

function renderAoE(entity: Entity): Volume | undefined {
  if (!entity.aoe) return undefined;
  const parsed = AoEShape.safeParse(entity.aoe);
  if (!parsed.success) return undefined; // Pre-M3 placeholder has no defined volume dimensions.
  return {
    shape: parsed.data,
    position: entity.transform.position,
    rotation: entity.transform.rotation,
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
    ...(scene.environment.skybox ? { skybox: scene.environment.skybox } : {}),
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
        ...(renderAoE(entity) ? { aoe: renderAoE(entity) } : {}),
        ...(entity.shape ? { shape: renderShape(entity, entity.shape) } : {}),
        ...(entity.layer === 'map' && entity.image
          ? {
              mapImage: {
                asset: entity.image.asset,
                scale: mapImageScale(entity.transform.scale.x),
              },
            }
          : {}),
        ...(entity.token?.rings
          ? {
              rings: entity.token.rings.map((ring) => ({
                ...ring,
                radius: ring.radius / scene.grid.unitsPerCell,
              })),
            }
          : {}),
        ...(entity.token
          ? {
              token: {
                image: entity.token.image,
                ...(entity.token.color ? { color: entity.token.color } : {}),
                name: entity.name,
                owners: entity.owners,
                entityLayer: entity.layer,
                perms: entity.perms,
                labelVisibility: entity.token.labelVisibility,
                yaw: yawFromQuaternion(entity.transform.rotation),
                ...(entity.token.flying ? { flying: true } : {}),
                // TOK-06: an empty list stays absent, so the strip never mounts for nothing.
                ...(entity.token.statusMarkers?.length
                  ? { statusMarkers: entity.token.statusMarkers }
                  : {}),
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
