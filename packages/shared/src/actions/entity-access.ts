import { viewEntity } from '../visibility/visible-to.js';
import { canReadTokenLabel } from '../visibility/token-label.js';
import {
  isFogRegion,
  isWall,
  visionRuleViolation,
  type Campaign,
  type Entity,
  type LayerId,
  type Scene,
} from '../schema/index.js';
import type { Actor } from './envelope.js';
import { isCoDm, isHost, seatOf } from './define.js';

export type EntityCapability = 'move' | 'edit' | 'delete';

export function isAdmin(state: Campaign, actor: Actor): boolean {
  return isHost(actor) || isCoDm(state, actor);
}

export function isLayerLocked(scene: Scene, layer: LayerId): boolean {
  return scene.layers[layer]?.locked ?? false;
}

/**
 * MV-290: a prop is a placed board object (a shape, model or image) that is not a token, an AoE or
 * a pin. Creating, editing and deleting props is admin work; a seat's Edit permission covers only
 * tokens.
 */
export function isProp(entity: Entity): boolean {
  if (entity.token || entity.aoe || entity.pin) return false;
  return entity.shape !== undefined || entity.model !== undefined || entity.image !== undefined;
}

/**
 * FOG-01 (D47 + MV-303): walls (doors included) and DM fog regions are admin-only placeables.
 * Unlike props, a player may not even move them, whatever their ownership or entity grants.
 */
export function isAdminOnlyPlaceable(entity: Entity): boolean {
  return isWall(entity) || isFogRegion(entity);
}

/** VIS-01: a wall that satisfies every vision rule (map layer, no other components, visible). */
export function validWallEntity(entity: Entity): boolean {
  return isWall(entity) && visionRuleViolation(entity) === undefined;
}

/** MV-303 Q2a: a fog region that satisfies every vision rule (dm layer, no other components). */
export function validFogRegionEntity(entity: Entity): boolean {
  return isFogRegion(entity) && visionRuleViolation(entity) === undefined;
}

/** FOG-01: the components only an admin may add or change through `entity.update`. */
export const ADMIN_ONLY_COMPONENTS = ['wall', 'blocksSight', 'fogRegion'] as const;

/**
 * PERM-01/02: a player needs both a seat capability and ownership/an entity grant. MV-290: a
 * player may never edit or delete a prop, whatever its owners or grants; moving one still follows
 * the ordinary move rule. FOG-01: a player may not move, edit or delete a wall or fog region at
 * all (`wall.setDoor` is the only door path a player can use).
 */
export function canUseEntity(
  state: Campaign,
  actor: Actor,
  entity: Entity,
  capability: EntityCapability,
): boolean {
  if (isHost(actor)) return true;
  const seat = seatOf(state, actor);
  // D32: a co-DM keeps admin control outside the DM layer, but the DM layer is read-only for
  // them unless the entity grants the capability (entity perms) or they own it and hold the
  // seat permission. Everything else falls through to the player rules below without the
  // `layer === 'dm'` block.
  if (seat?.role === 'codm') {
    if (entity.layer !== 'dm') return true;
    const owns = entity.owners.includes(seat.id);
    return entity.perms?.[capability] === true || (owns && seat.permissions[capability]);
  }
  if (!seat || entity.layer === 'dm' || !seat.permissions.view) return false;
  if (isAdminOnlyPlaceable(entity)) return false;
  if (capability !== 'move' && isProp(entity)) return false;

  const owns = entity.owners.includes(seat.id);
  const canView = owns || entity.perms?.view !== false;
  const hasGrant = owns || entity.perms?.[capability] === true;
  return canView && seat.permissions[capability] && hasGrant;
}

/**
 * D32: may this actor act as admin on entities of `layer`? The host always; a co-DM everywhere
 * except the DM layer (creating there, locking it, moving entities onto it, re-owning or
 * re-permissioning its entities are all host-only).
 */
export function isAdminOn(state: Campaign, actor: Actor, layer: LayerId): boolean {
  return isHost(actor) || (isCoDm(state, actor) && layer !== 'dm');
}

/** PERM-03: editing a replacement marker list requires seeing the existing list. */
export function canReadEntityLabel(state: Campaign, actor: Actor, entity: Entity): boolean {
  if (isHost(actor)) return true;
  if (actor.kind !== 'seat' || !actor.seatId) return false;
  const audience = { kind: 'seat' as const, seatId: actor.seatId };
  const seat = seatOf(state, actor);
  return viewEntity(audience, entity, seat) !== null && canReadTokenLabel(audience, entity, seat);
}
