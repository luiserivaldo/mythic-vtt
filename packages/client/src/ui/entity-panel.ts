import {
  clampToBounds,
  resolveSceneBounds,
  snapToGrid,
  type AssetRef,
  type Campaign,
  type Entity,
  type LayerId,
  type Scene,
} from '@mythic/shared';
import { SIZE_CELLS } from '../render/token-footprint.js';
import { LAYER_ORDER } from './layer-panel.js';
import type { IntentSpec } from './intent-specs.js';

export type TokenSizeName = keyof typeof SIZE_CELLS;
export const TOKEN_SIZE_NAMES = Object.keys(SIZE_CELLS) as TokenSizeName[];

export const PRIMITIVE_KINDS = [
  'box',
  'cylinder',
  'cone',
  'pyramid',
  'sphere',
  'plane',
  'wedge',
] as const;
export type PrimitiveKind = (typeof PRIMITIVE_KINDS)[number];

export type LabelVisibility = 'all' | 'owner' | 'dm';
export const LABEL_VISIBILITIES: readonly { value: LabelVisibility; label: string }[] = [
  { value: 'all', label: 'Everyone' },
  { value: 'owner', label: 'Owner only' },
  { value: 'dm', label: 'DM only' },
];

export const LAYER_LABELS: Record<LayerId, string> = {
  map: 'Map',
  props: 'Props',
  tokens: 'Tokens',
  dm: 'DM only',
  effects: 'Effects',
};

export const DEFAULT_TOKEN_COLOR = '#46b6cf';
export const MAX_PROP_CELLS = 50;
const UNIT_ROTATION = { x: 0, y: 0, z: 0, w: 1 } as const;
const COLOUR = /^#[0-9a-fA-F]{6}$/;

export const isValidEntityName = (text: string): boolean => {
  const t = text.trim();
  return t.length >= 1 && t.length <= 120;
};
export const isValidColour = (text: string): boolean => COLOUR.test(text);
export const isValidPropSize = (n: number): boolean =>
  Number.isFinite(n) && n > 0 && n <= MAX_PROP_CELLS;

export const capitalise = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/** M1-30: one tested source of truth for the token form's creation defaults. */
export const TOKEN_FORM_DEFAULTS = {
  name: '',
  size: 'medium',
  layer: 'tokens',
  labelVisibility: 'all',
  ownerId: '',
  color: DEFAULT_TOKEN_COLOR,
} as const satisfies {
  name: string;
  size: TokenSizeName;
  layer: LayerId;
  labelVisibility: LabelVisibility;
  ownerId: string;
  color: string;
};

export interface OwnerOption {
  id: string;
  label: string;
}

/** Seats an entity can be owned by, in a stable order (entity.create requires existing seats). */
export function ownerOptions(campaign: Campaign): OwnerOption[] {
  return Object.values(campaign.seats)
    .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
    .map((s) => ({ id: s.id, label: s.label }));
}

/** Successive spawns step diagonally by one cell and wrap, so they never stack exactly. */
export const SPAWN_STEPS = 5;

/**
 * New entities land at the centre of the scene canvas (D37), snapped to the grid for their
 * footprint. `spawnIndex` (how many entities the scene already holds) offsets successive spawns.
 * A hex grid is unsupported by snapToGrid, so it keeps the unsnapped centre.
 */
export function placementPosition(scene: Scene, footprint: number, spawnIndex = 0) {
  const bounds = resolveSceneBounds(scene);
  const step = Math.max(0, Math.floor(spawnIndex)) % SPAWN_STEPS;
  const raw = clampToBounds(bounds, {
    x: bounds.width / 2 + step,
    y: 0,
    z: bounds.height / 2 + step,
  });
  let position = raw;
  try {
    position = snapToGrid(raw, scene.grid, { footprint: Math.max(1, Math.round(footprint)) });
  } catch {
    // Unsupported grid: keep the unsnapped position.
  }
  // Snapping an odd footprint to a cell centre can land half a cell past the edge (D37).
  return {
    ...position,
    x: position.x > bounds.width ? position.x - 1 : position.x,
    z: position.z > bounds.height ? position.z - 1 : position.z,
  };
}

/** Number of entities already in the scene, used as the spawn offset index. */
export const spawnIndexOf = (scene: Scene): number => Object.keys(scene.entities).length;

export interface TokenDraft {
  sceneId: string;
  entityId: string;
  name: string;
  size: TokenSizeName;
  layer: LayerId;
  labelVisibility: LabelVisibility;
  ownerId: string | null;
  imageHash: string | null;
  imageName?: string;
  /** D38: placeholder colour for a token without an image (#rrggbb). */
  color?: string;
}

function createSpec(sceneId: string, entity: Entity): IntentSpec {
  return { type: 'entity.create', payload: { sceneId, entity }, sceneId };
}

/** TOK-01. D38: `color` is the placeholder fill for a token without an image. */
export function tokenCreateIntent(scene: Scene, d: TokenDraft): IntentSpec {
  const cells = SIZE_CELLS[d.size];
  const image: AssetRef | undefined = d.imageHash
    ? { source: 'local', hash: d.imageHash, kind: 'image', name: d.imageName ?? d.name.trim() }
    : undefined;
  return createSpec(d.sceneId, {
    id: d.entityId,
    layer: d.layer,
    name: d.name.trim(),
    owners: d.ownerId ? [d.ownerId] : [],
    transform: {
      position: placementPosition(scene, cells, spawnIndexOf(scene)),
      rotation: UNIT_ROTATION,
      scale: { x: 1, y: 1, z: 1 },
    },
    token: {
      sizeCells: cells,
      heightCells: cells,
      labelVisibility: d.labelVisibility,
      ...(image ? { image } : {}),
      ...(d.color && isValidColour(d.color) ? { color: d.color } : {}),
    },
  });
}

export interface PropDraft {
  sceneId: string;
  entityId: string;
  name: string;
  kind: PrimitiveKind;
  color: string;
  size: { x: number; y: number; z: number };
  walkable: boolean;
  layer: LayerId;
}

/** ENV-02: a primitive prop; scale is its size in cells and its base sits at elevation 0. */
export function propCreateIntent(scene: Scene, d: PropDraft): IntentSpec {
  return createSpec(d.sceneId, {
    id: d.entityId,
    layer: d.layer,
    name: d.name.trim(),
    owners: [],
    transform: {
      position: placementPosition(scene, d.size.x, spawnIndexOf(scene)),
      rotation: UNIT_ROTATION,
      scale: { ...d.size },
    },
    shape: { kind: d.kind, color: d.color, walkable: d.walkable },
  });
}

export const entityRenameIntent = (
  sceneId: string,
  entityId: string,
  name: string,
): IntentSpec => ({
  type: 'entity.update',
  payload: { sceneId, entityId, changes: { name: name.trim() } },
  sceneId,
});

/** GRID-05: replaces the shape with showGridOnTop set (entity.update merges top-level fields). */
export const entityShowGridOnTopIntent = (
  sceneId: string,
  entityId: string,
  shape: NonNullable<Entity['shape']>,
  showGridOnTop: boolean,
): IntentSpec => ({
  type: 'entity.update',
  payload: { sceneId, entityId, changes: { shape: { ...shape, showGridOnTop } } },
  sceneId,
});

export const entityDeleteIntent = (sceneId: string, entityId: string): IntentSpec => ({
  type: 'entity.delete',
  payload: { sceneId, entityId },
  sceneId,
});

export interface EntityRow {
  id: string;
  name: string;
  kind: string;
  layer: LayerId;
  layerLabel: string;
  owners: string;
}

const LAYER_RANK = new Map<LayerId, number>(LAYER_ORDER.map((l, i) => [l, i]));

function kindOf(e: Entity): string {
  if (e.token) return 'Token';
  if (e.shape) return capitalise(e.shape.kind);
  if (e.image) return 'Image';
  if (e.aoe) return 'Area';
  if (e.pin) return 'Pin';
  return 'Entity';
}

/** Entities of one scene in a stable order: layer, then name, then id. Battlemaps are listed too. */
export function entityRows(campaign: Campaign, scene: Scene): EntityRow[] {
  return Object.values(scene.entities)
    .sort(
      (a, b) =>
        (LAYER_RANK.get(a.layer) ?? 0) - (LAYER_RANK.get(b.layer) ?? 0) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    )
    .map((e) => ({
      id: e.id,
      name: e.name,
      kind: kindOf(e),
      layer: e.layer,
      layerLabel: LAYER_LABELS[e.layer],
      owners: e.owners.map((id) => campaign.seats[id]?.label ?? 'Unknown seat').join(', '),
    }));
}
