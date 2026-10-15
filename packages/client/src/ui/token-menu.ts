import {
  canPerform,
  isLayerLocked,
  type Actor,
  type AssetRef,
  type Campaign,
  type Entity,
  type LayerId,
  type Scene,
} from '@mythic/shared';
import { labelAnchor3d } from '../render/token-standee.js';
import { HIDDEN_TOKEN_NAME, labelState, type LabelSubject } from '../render/token-labels.js';
import { footprintCells } from '../render/token-footprint.js';
import { canSelect, type SelectionActor } from '../tools/selection.js';
import { parseNumber } from '../tools/transform-gizmo.js';
import { elevationFromUnits } from '../tools/elevation.js';
import { entityDeleteIntent, entityRenameIntent } from './entity-panel.js';
import type { IntentSpec } from './intent-specs.js';
import { moveTargets } from './layer-panel.js';

// UI-TOKEN-02 / UI-TOKEN-03: the full token menu ("options") and the short right-click menu
// ("quick"). Nothing here is game state (PERM-01): the models are derived from the host-filtered
// snapshot and every intent goes through the ordinary submit path, which the host re-checks
// (PERM-02). A viewer's own capability is read with the same shared functions the host uses, so a
// field is never offered as editable when the action would be refused (UIUX §1.7, D32).

export const TOKEN_MENU_FIELD_IDS = [
  'name',
  'image',
  'height',
  'flying',
  'layer',
  'delete',
] as const;
export type TokenMenuFieldId = (typeof TOKEN_MENU_FIELD_IDS)[number];

/** What the user reads; requirement IDs stay in these comments. */
export const TOKEN_MENU_LABELS: Readonly<Record<TokenMenuFieldId, string>> = {
  name: 'Name',
  image: 'Image',
  height: 'Height',
  flying: 'Flying (locks height)',
  layer: 'Layer',
  delete: 'Delete',
};

export const TOKEN_CONTEXT_IDS = [
  'see-sheet',
  'add-condition',
  'change-layer',
  'ping',
  'token-options',
] as const;
export type TokenContextActionId = (typeof TOKEN_CONTEXT_IDS)[number];

export const TOKEN_CONTEXT_LABELS: Readonly<Record<TokenContextActionId, string>> = {
  'see-sheet': 'See Sheet',
  'add-condition': 'Add Condition',
  'change-layer': 'Change Layer',
  // UX-40: ping moved off the rail; the menu button is gated by the scene's pins toggle (PERM-05).
  ping: 'Ping',
  'token-options': 'Token Options',
};

/** TOK-03 / D25: the same limit the elevation action enforces. */
export const INVALID_HEIGHT_MESSAGE = 'Enter a height within 1000 cells.';

const LOCKED_REASON = 'That layer is locked.';
const NO_EDIT_REASON = 'You cannot edit this token.';
const NO_MOVE_REASON = 'You cannot move this token.';
const NO_DELETE_REASON = 'You cannot delete this token.';
const NO_NAME_REASON = 'This token’s name is not shared with you.';
const NO_TARGET_REASON = 'Not allowed';
const NO_LAYER_REASON = 'No layer is available.';
const WIP_REASON = 'Not available yet.';

const ELEVATION_LIMIT = 1000;

export interface TokenMenuField {
  id: TokenMenuFieldId;
  label: string;
  enabled: boolean;
  /** null when the viewer may use it; else why it is shown disabled. */
  disabledReason: string | null;
}

export interface TokenLayerTarget {
  layer: LayerId;
  label: string;
  enabled: boolean;
  /** null when enabled, else why the host would refuse that layer. */
  reason: string | null;
}

export interface TokenMenuModel {
  /** The name this menu may print (D35 stand-in when the label is not shared). */
  name: string;
  fields: TokenMenuField[];
  layers: TokenLayerTarget[];
}

export interface TokenContextItem {
  id: TokenContextActionId;
  label: string;
  enabled: boolean;
  /** A WIP placeholder: greyed, labelled and never interactive (UIUX §1.7). */
  wip: boolean;
  reason: string | null;
}

export interface TokenMenuInput {
  campaign: Campaign;
  scene: Scene;
  entity: Entity;
  /** The actor the host would see, so the menu mirrors the host's own decision (PERM-02). */
  actor: Actor;
  /** The local selection actor, for the label rule (D35) and selectability (PERM-01). */
  viewer: SelectionActor;
}

function subjectOf(entity: Entity): LabelSubject {
  return {
    name: entity.name,
    layer: entity.layer,
    owners: entity.owners,
    perms: entity.perms,
    labelVisibility: entity.token?.labelVisibility ?? 'all',
  };
}

/**
 * UI-TOKEN-02 / D35: the name the menu shows. A name this viewer may not read — including one the
 * host already blanked — becomes the neutral stand-in, never the name itself.
 */
export function tokenMenuName(entity: Entity, viewer: SelectionActor): string {
  return labelState(subjectOf(entity), viewer) === 'visible' ? entity.name : HIDDEN_TOKEN_NAME;
}

/** UI-TOKEN-02 / TOK-03: may this viewer move the token (height, flight, layer)? */
export function tokenMayMove(input: TokenMenuInput): boolean {
  const { campaign, entity, actor } = input;
  const world = worldOf(input);
  if (!entity.token || isLayerLocked(world, entity.layer)) return false;
  return canPerform(campaign, actor, 'token.setElevation', {
    sceneId: world.id,
    entityId: entity.id,
    elevation: clampElevation(entity.transform.position.y),
  });
}

/** LAY-07: the layers this token may move to, with the reason the host would refuse each. */
export function tokenLayerTargets(input: TokenMenuInput): TokenLayerTarget[] {
  const { campaign, entity, actor } = input;
  const world = worldOf(input);
  return moveTargets(world, entity).map((target) => {
    const enabled = canPerform(campaign, actor, 'entity.setLayer', {
      sceneId: world.id,
      entityId: entity.id,
      layer: target.layer,
    });
    return {
      layer: target.layer,
      label: target.label,
      enabled,
      reason: enabled ? null : (target.disabledReason ?? NO_TARGET_REASON),
    };
  });
}

/**
 * The scene the checks run against. The campaign's own copy wins: `canPerform` reads the scene
 * through the campaign, and the two must not disagree about a lock.
 */
function worldOf(input: TokenMenuInput): Scene {
  return input.campaign.scenes[input.scene.id] ?? input.scene;
}

/** UI-TOKEN-02: which of the full menu's fields this viewer may use, and why not. */
export function tokenMenuModel(input: TokenMenuInput): TokenMenuModel {
  const { campaign, entity, actor, viewer } = input;
  const world = worldOf(input);
  const sceneId = world.id;
  const entityId = entity.id;
  const locked = isLayerLocked(world, entity.layer);
  const labelReadable = labelState(subjectOf(entity), viewer) === 'visible';
  const token = entity.token;

  const mayRename = canPerform(campaign, actor, 'entity.update', {
    sceneId,
    entityId,
    changes: { name: entity.name },
  });
  const mayEditImage =
    token !== undefined &&
    canPerform(campaign, actor, 'entity.update', { sceneId, entityId, changes: { token } });
  const maySetFlying =
    token !== undefined &&
    canPerform(campaign, actor, 'token.setFlying', {
      sceneId,
      entityId,
      flying: token.flying === true,
    });
  const mayDelete = canPerform(campaign, actor, 'entity.delete', { sceneId, entityId });
  const mayMove = tokenMayMove(input);
  const layers = tokenLayerTargets(input);

  const field = (id: TokenMenuFieldId, enabled: boolean, fallback: string): TokenMenuField => ({
    id,
    label: TOKEN_MENU_LABELS[id],
    enabled,
    disabledReason: enabled ? null : locked ? LOCKED_REASON : fallback,
  });

  return {
    name: tokenMenuName(entity, viewer),
    fields: [
      field('name', mayRename && labelReadable, labelReadable ? NO_EDIT_REASON : NO_NAME_REASON),
      field('image', mayEditImage, NO_EDIT_REASON),
      field('height', mayMove, NO_MOVE_REASON),
      field('flying', mayMove && maySetFlying, NO_MOVE_REASON),
      field('layer', mayMove && layers.some((target) => target.enabled), NO_MOVE_REASON),
      field('delete', mayDelete, NO_DELETE_REASON),
    ],
    layers,
  };
}

/**
 * UI-TOKEN-03: the curated right-click list, to the right of the token. It shows only what this
 * viewer may do; a viewer who may not select the token gets nothing at all. See Sheet and Token
 * Options are always there; Add Condition is the honest WIP placeholder; Change Layer appears only
 * when the token can be moved.
 */
export function tokenContextMenu(input: TokenMenuInput): TokenContextItem[] {
  const { entity, viewer } = input;
  if (!canSelect(entity, worldOf(input), viewer)) return [];

  const items: TokenContextItem[] = [
    {
      id: 'see-sheet',
      label: TOKEN_CONTEXT_LABELS['see-sheet'],
      enabled: true,
      wip: false,
      reason: null,
    },
    {
      id: 'add-condition',
      label: TOKEN_CONTEXT_LABELS['add-condition'],
      enabled: false,
      wip: true,
      reason: WIP_REASON,
    },
  ];
  if (tokenMayMove(input)) {
    const anyLayer = tokenLayerTargets(input).some((target) => target.enabled);
    items.push({
      id: 'change-layer',
      label: TOKEN_CONTEXT_LABELS['change-layer'],
      enabled: anyLayer,
      wip: false,
      reason: anyLayer ? null : NO_LAYER_REASON,
    });
  }
  items.push({
    id: 'ping',
    label: TOKEN_CONTEXT_LABELS.ping,
    enabled: true,
    wip: false,
    reason: null,
  });
  items.push({
    id: 'token-options',
    label: TOKEN_CONTEXT_LABELS['token-options'],
    enabled: true,
    wip: false,
    reason: null,
  });
  return items;
}

/** Gap between the token's edge and its menu, in cells. */
export const MENU_SIDE_GAP = 0.1;

/**
 * UI-TOKEN-02: the menu's anchor, beside the token. 2D screen right is world +X, and the 3D
 * standee is anchored at half its height above the base, so the panel clears the token in both
 * views. A malformed footprint clamps to one cell instead of anchoring the panel at NaN.
 */
export function tokenMenuAnchor(
  mode: '2d' | '3d',
  position: readonly [number, number, number],
  sizeCells: number | undefined,
): readonly [number, number, number] {
  const cells = footprintCells(sizeCells);
  const [x, y, z] = position;
  const beside = x + cells / 2 + MENU_SIDE_GAP;
  switch (mode) {
    case '2d':
      return [beside, y, z];
    case '3d':
      return [beside, y + labelAnchor3d(cells)[1] / 2, z];
  }
}

/**
 * TOK-03 / D25: a typed height in scene units -> cells, snapped when the grid snaps. A clamped
 * value that the action would refuse (|cells| > 1000) or unreadable text is rejected rather than
 * silently sent.
 */
export function tokenMenuHeight(
  text: string,
  grid: { snap: boolean; unitsPerCell: number },
): { ok: true; cells: number } | { ok: false; reason: string } {
  const units = parseNumber(text);
  if (units === null) return { ok: false, reason: INVALID_HEIGHT_MESSAGE };
  const cells = elevationFromUnits(units, grid);
  if (cells === null) return { ok: false, reason: INVALID_HEIGHT_MESSAGE };
  return { ok: true, cells };
}

/** TOK-01 / TOK-02: rename reuses the entity panel's own intent. */
export const tokenRenameIntent = entityRenameIntent;

/** TOK-01 / ENV-01: a new token image, sent as the whole (viewer-visible) token component. */
export function tokenImageIntent(
  sceneId: string,
  entityId: string,
  token: NonNullable<Entity['token']>,
  image: AssetRef,
): IntentSpec {
  return {
    type: 'entity.update',
    sceneId,
    payload: { sceneId, entityId, changes: { token: { ...token, image } } },
  };
}

/** TOK-03 / D25. */
export function tokenHeightIntent(
  sceneId: string,
  entityId: string,
  elevation: number,
): IntentSpec {
  return {
    type: 'token.setElevation',
    sceneId,
    payload: { sceneId, entityId, elevation },
  };
}

/** TOK-03 / Q26. */
export function tokenFlyingIntent(sceneId: string, entityId: string, flying: boolean): IntentSpec {
  return { type: 'token.setFlying', sceneId, payload: { sceneId, entityId, flying } };
}

/** LAY-07. */
export function tokenLayerIntent(sceneId: string, entityId: string, layer: LayerId): IntentSpec {
  return { type: 'entity.setLayer', sceneId, payload: { sceneId, entityId, layer } };
}

/** PERM-02. */
export const tokenDeleteIntent = entityDeleteIntent;

function clampElevation(cells: number): number {
  if (!Number.isFinite(cells)) return 0;
  return Math.min(ELEVATION_LIMIT, Math.max(-ELEVATION_LIMIT, cells));
}
