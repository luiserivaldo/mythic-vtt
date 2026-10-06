import type { Campaign, Entity, LayerId, Scene } from '../schema/index.js';
import type { Actor } from './envelope.js';
import { isCoDm, isHost, seatOf } from './define.js';

export type EntityCapability = 'move' | 'edit' | 'delete';

export function isAdmin(state: Campaign, actor: Actor): boolean {
  return isHost(actor) || isCoDm(state, actor);
}

export function isLayerLocked(scene: Scene, layer: LayerId): boolean {
  return scene.layers[layer]?.locked ?? false;
}

/** PERM-01/02: a player needs both a seat capability and ownership/an entity grant. */
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
