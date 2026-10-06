import type { AssetRef, Campaign, Entity, Scene } from '@mythic/shared';
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

export interface RenderScene {
  id: string;
  background: string;
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

/** A malformed scale falls back to one cell rather than hiding or exploding the image. */
export function mapImageScale(scale: number): number {
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

export function mapScene(scene: Scene): RenderScene {
  return {
    id: scene.id,
    background: scene.environment.background,
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
